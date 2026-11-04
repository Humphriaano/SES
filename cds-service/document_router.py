"""
Document Upload & AI Extraction router
  POST /api/documents/upload          — upload file, OCR/extract text, run Ollama, return JSON
  POST /api/documents/save            — persist document metadata to DB
  GET  /api/documents/{patient_id}    — list documents for a patient
  GET  /api/documents/file/{doc_id}   — serve original file
"""

import json
import os
import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

import ollama
import httpx
import psycopg2
import psycopg2.extras
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

# ── configuration ──────────────────────────────────────────────────────────────

from config import LLM_MODEL, OLLAMA_URL, MODEL_NUM_CTX, THINKING_MODEL

_ollama    = ollama.Client(host=OLLAMA_URL)

# File storage: cds-service/documents/{patient_id}/
DOCS_DIR = Path(__file__).parent / "documents"
DOCS_DIR.mkdir(exist_ok=True)

# PostgreSQL — read DATABASE_URL from env, fall back to local dev default
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:Hypercrux@localhost:5432/ses_ehr"
)

# Tesseract path (Windows default install location)
TESSERACT_CMD = os.getenv(
    "TESSERACT_CMD",
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

# ── database helpers ──────────────────────────────────────────────────────────

def _db():
    """Open a psycopg2 connection and ensure the documents table exists."""
    conn = psycopg2.connect(DATABASE_URL)
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS patient_documents (
                id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                patient_id    VARCHAR NOT NULL,
                filename      VARCHAR NOT NULL,
                file_path     VARCHAR NOT NULL,
                document_type VARCHAR,
                extracted_json TEXT,
                uploaded_at   TIMESTAMP DEFAULT NOW()
            )
        """)
    conn.commit()
    return conn


def _list_docs(patient_id: str) -> list[dict]:
    with _db() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM patient_documents WHERE patient_id = %s ORDER BY uploaded_at DESC",
                (patient_id,)
            )
            rows = cur.fetchall()
    return [dict(r) for r in rows]


def _save_doc(patient_id: str, filename: str, file_path: str,
              document_type: str, extracted_json: str) -> dict:
    with _db() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO patient_documents
                    (patient_id, filename, file_path, document_type, extracted_json)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING *
                """,
                (patient_id, filename, file_path, document_type, extracted_json)
            )
            row = cur.fetchone()
        conn.commit()
    return dict(row)


def _get_doc(doc_id: str) -> Optional[dict]:
    with _db() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM patient_documents WHERE id = %s",
                (doc_id,)
            )
            row = cur.fetchone()
    return dict(row) if row else None


# ── text extraction ───────────────────────────────────────────────────────────
#
# Minimum characters per page below which we treat the page as having no
# usable text layer (e.g. a stray header/footer artifact isn't "real" text)
# and fall back to OCR for that page.
MIN_TEXT_LAYER_CHARS_PER_PAGE = 20


def _ocr_image(img) -> str:
    import pytesseract
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD
    return pytesseract.image_to_string(img)


def _extract_text_pdf(file_bytes: bytes) -> str:
    """
    Direct text-layer extraction (pdfplumber) with a per-page OCR fallback.
    Many "PDFs" are actually scanned/photographed documents with no text
    layer at all — pdfplumber.extract_text() returns None/empty for those
    pages, and previously that meant the whole document silently produced
    zero text. Each such page is now rendered to an image (pdfplumber's
    built-in renderer — no poppler/ImageMagick dependency) and OCR'd instead.
    """
    import io
    import pdfplumber

    text_parts = []
    ocr_pages = 0
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        total_pages = len(pdf.pages)
        for i, page in enumerate(pdf.pages, start=1):
            t = (page.extract_text() or "").strip()
            if len(t) >= MIN_TEXT_LAYER_CHARS_PER_PAGE:
                print(f"[document_router] page {i}/{total_pages}: text layer, {len(t)} chars", flush=True)
                text_parts.append(t)
                continue

            print(f"[document_router] page {i}/{total_pages}: no usable text layer ({len(t)} chars) -> OCR fallback", flush=True)
            try:
                rendered = page.to_image(resolution=200).original
                ocr_text = _ocr_image(rendered).strip()
                print(f"[document_router] page {i}/{total_pages}: OCR extracted {len(ocr_text)} chars", flush=True)
                if ocr_text:
                    text_parts.append(ocr_text)
                    ocr_pages += 1
            except Exception as e:
                print(f"[document_router] page {i}/{total_pages}: OCR fallback failed: {e}", flush=True)

    if ocr_pages:
        print(f"[document_router] PDF used OCR fallback on {ocr_pages}/{total_pages} page(s)", flush=True)
    return "\n\n".join(text_parts)


def _extract_text_docx(file_bytes: bytes) -> str:
    import io
    from docx import Document
    doc = Document(io.BytesIO(file_bytes))
    return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())


def _extract_text_image(file_bytes: bytes) -> str:
    import io
    from PIL import Image
    img = Image.open(io.BytesIO(file_bytes))
    return _ocr_image(img)


# ── JSON helpers (same pattern as existing CDS service) ──────────────────────

def _extract_json(text: str) -> dict:
    # Qwen 3 thinking blocks must go before brace-hunting — thinking prose can
    # contain stray '{' that would corrupt the outermost-object search. We also
    # pass think=False on the chat call; this is the belt-and-braces layer
    # (same approach as the CDS panel's extract_json in main.py).
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL)
    text = re.sub(r'^.*?</think>', '', text, flags=re.DOTALL)  # unclosed/partial variant
    text = re.sub(r'```json|```', '', text).strip()
    start = text.find('{')
    end   = text.rfind('}')
    if start == -1 or end == -1:
        raise ValueError(f"No JSON object found. Raw: {text[:300]}")
    text = text[start:end + 1]
    text = re.sub(r',\s*}', '}', text)
    text = re.sub(r',\s*]', ']', text)
    text = re.sub(r"'\"(.*?)\"'", r'"\1"', text)
    return json.loads(text)


# ── grounding gate ────────────────────────────────────────────────────────────
#
# The prompt tells the model never to hallucinate lab/vitals values, but LLMs
# don't reliably follow prompt-only instructions — this is a hard, code-level
# check run after parsing: every number in an extracted lab result or vitals
# value must be traceable back to the literal OCR'd/text-layer source. Minor
# formatting differences (missing space before a unit, etc.) don't matter
# because only the numeric tokens are compared, not the full formatted string.

_NUMBER_RE = re.compile(r'-?\d+(?:\.\d+)?')


def _numbers_in(value: str) -> list[str]:
    return _NUMBER_RE.findall(value or "")


def _number_in_source(number: str, source_text: str) -> bool:
    # Word-boundary-style check so "14" doesn't false-match inside "140".
    pattern = re.compile(rf'(?<!\d){re.escape(number)}(?!\d)')
    return bool(pattern.search(source_text))


def _value_is_grounded(value: str, source_text: str) -> bool:
    numbers = _numbers_in(value)
    if not numbers:
        return False  # no numeric content — can't verify a "value" with no number
    return all(_number_in_source(n, source_text) for n in numbers)


def _apply_grounding(extracted: dict, source_text: str) -> dict:
    kept_labs = []
    for lr in extracted.get("lab_results", []) or []:
        if _value_is_grounded(lr.get("value", ""), source_text):
            kept_labs.append(lr)
        else:
            print(f"[document_router] GROUNDING: dropped hallucinated lab result "
                  f"{lr!r} — value not found in source text", flush=True)
    extracted["lab_results"] = kept_labs

    kept_vitals = []
    for v in extracted.get("vitals", []) or []:
        if _value_is_grounded(v.get("value", ""), source_text):
            kept_vitals.append(v)
        else:
            print(f"[document_router] GROUNDING: dropped hallucinated vital "
                  f"{v!r} — value not found in source text", flush=True)
    extracted["vitals"] = kept_vitals

    return extracted


EXTRACTION_PROMPT = """You are a medical document parser. Your job is to read the document text below and extract ONLY the clinical data that is literally written in it. You must never add, infer, guess, or supply typical/reference/textbook values for a condition — if it is not on the page, it does not go in the output.

Return ONLY a valid JSON object with exactly this structure — no prose, no markdown, no explanation, just the JSON:
{{
  "document_type": "string (e.g. Lab Report, Discharge Summary, Prescription, Referral Letter, X-ray Report)",
  "lab_results": [
    {{"test_name": "string", "value": "string", "unit": "string", "reference_range": "string or empty", "flag": "string (Normal/High/Low/Critical or empty)"}}
  ],
  "pending_investigations": [
    {{"test_name": "string", "status": "string (Ordered/Pending/Requested)", "notes": "string or empty"}}
  ],
  "diagnoses": [
    {{"diagnosis": "string", "category": "string or empty"}}
  ],
  "medications": [
    {{"name": "string", "dose": "string", "route": "string or empty", "frequency": "string", "duration": "string or empty"}}
  ],
  "vitals": [
    {{"parameter": "string", "value": "string", "unit": "string", "date": "string or empty"}}
  ],
  "other_notes": "string"
}}

CRITICAL RULES — follow every one exactly:

GROUNDING (most important rule — read this first):
- Extract a value ONLY if you can point to the exact word or number in the document text below.
- Do NOT extract typical/expected/reference lab values or vitals just because a diagnosis or condition is mentioned. A diagnosis name alone is never evidence of a lab or vitals number — if the document doesn't print an actual measured value, it does not exist for this task.
- If the document contains no lab results, return "lab_results": []. If it contains no vitals numbers, return "vitals": []. An empty array is the correct, expected answer for many documents — do not pad it.

LAB RESULTS (only tests with an actual resulted value in the text):
- Extract EVERY individual resulted test as a separate object. If the document lists 15 resulted tests, your array must contain 15 objects.
- Sections like "Haematology", "Biochemistry", "Immunology" are headings — not tests. List every test under each heading individually.
- Copy the exact value and unit from the document. Do not round or reformat.
- Copy the reference range exactly as printed (e.g. "3.5-5.0" or "70-100 mg/dL").
- If a test is only ordered/requested with no result value yet, it does NOT belong here — put it in pending_investigations instead.

PENDING INVESTIGATIONS (tests/imaging ordered or requested but NOT yet resulted):
- List anything described as ordered, requested, pending, or awaiting results (e.g. "Abdominal Ultrasound requested", "CT scan pending") — these have no value/unit/reference_range because no result exists yet.
- Never place a pending investigation in lab_results, and never invent a result value for it.
- If none are mentioned, use [].

DIAGNOSES:
- Each element is one clinical condition: {{"diagnosis": "<condition name, copied exactly as written>", "category": "<its specialty/category label if the document gives one, e.g. Gastrointestinal, Cardiovascular — otherwise empty string>"}}.
- A specialty/category/system label written next to or under a diagnosis (e.g. "Gastrointestinal", "Cardiology") describes that diagnosis — it is metadata, NOT a diagnosis of its own. Never emit it as a separate entry in this array.
- If the document lists 4 diagnoses, your array must contain exactly 4 objects — not more.
- Do NOT add diagnoses that are not written in the document.

MEDICATIONS:
- Extract EVERY medication, IV fluid, blood product, or supplement listed.
- Include name, dose, route (oral/IV/IM/etc.), frequency (OD/BD/TDS/etc.), and duration if stated.
- If a field is not mentioned, use an empty string — do not omit the object.

VITALS (only numbers actually printed in the document):
- Extract EVERY vital sign that has an exact numeric value written in the text, with its unit.
- Valid parameters include: Blood Pressure (Systolic), Blood Pressure (Diastolic), Heart Rate, Temperature, SpO2, Respiratory Rate, Weight, Blood Glucose, and any others present.
- Copy values exactly from the document — do not substitute typical/normal values, and do not fabricate a vitals set just because the document describes a clinical presentation or exam.

GENERAL:
- Use [] for sections with no data; "" for other_notes if empty.
- Never invent, infer, or hallucinate values. If you are not certain a value appears verbatim in the document, omit it entirely.

Document text:
{text}"""


# ── Pydantic models ────────────────────────────────────────────────────────────

class SaveDocumentRequest(BaseModel):
    patient_id:    str
    filename:      str
    file_path:     str
    document_type: str
    extracted_json: str


# ── router ────────────────────────────────────────────────────────────────────

async def require_document_access(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sign in to access clinical documents.")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                "http://127.0.0.1:5000/api/auth/me",
                headers={"Authorization": authorization},
            )
    except httpx.RequestError:
        raise HTTPException(status_code=503, detail="Could not verify document access. Try again.")
    if response.status_code == 401:
        raise HTTPException(status_code=401, detail="Sign in to access clinical documents.")
    if response.status_code != 200:
        raise HTTPException(status_code=503, detail="Could not verify document access. Try again.")
    roles = {role.strip() for role in str(response.json().get("role", "")).split(",")}
    if not roles.intersection({"admin", "clinician", "doctor", "nurse", "pharmacist", "lab_tech", "lab_technician", "paramedic"}):
        raise HTTPException(status_code=403, detail="Clinical access is required for documents.")


router = APIRouter(prefix="/api/documents", tags=["documents"], dependencies=[Depends(require_document_access)])


@router.post("/upload")
async def upload_document(
    patient_id: str = Form(...),
    file: UploadFile = File(...),
):
    """
    Accept a PDF or image, extract text, run Ollama AI extraction,
    save the file to disk, and return the structured findings.
    """
    content_type = (file.content_type or "").lower()
    filename     = file.filename or "upload"
    suffix       = Path(filename).suffix.lower()

    file_bytes = await file.read()
    print(f"[document_router] file received: name={filename!r} suffix={suffix!r} "
          f"content_type={content_type!r} size={len(file_bytes)} bytes", flush=True)

    # ── text extraction ──────────────────────────────────────────────────────
    # `route` records which path was taken so the final error (if any) says
    # exactly where extraction stopped, instead of one generic message.
    route = "unknown"
    try:
        if suffix == ".pdf" or "pdf" in content_type:
            route = "pdf (text layer + per-page OCR fallback)"
            raw_text = _extract_text_pdf(file_bytes)
        elif suffix in (".docx",) or "wordprocessingml" in content_type or "msword" in content_type:
            route = "docx"
            raw_text = _extract_text_docx(file_bytes)
        elif suffix in (".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp") or "image" in content_type:
            route = "image OCR"
            raw_text = _extract_text_image(file_bytes)
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type '{suffix}'. Upload a PDF, Word document, or image."
            )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[document_router] extraction FAILED at stage '{route}': {type(e).__name__}: {e}", flush=True)
        raise HTTPException(status_code=422, detail=f"Text extraction failed ({route}): {e}")

    print(f"[document_router] extraction stage '{route}' produced {len(raw_text.strip())} chars", flush=True)

    if not raw_text.strip():
        raise HTTPException(
            status_code=422,
            detail=(
                f"No text could be extracted from the document (route: {route}, "
                f"file: {filename}, {len(file_bytes)} bytes). "
                "If this is a scanned/photographed document, the image quality or "
                "orientation may be too poor for OCR — try a clearer scan or a PDF "
                "with a real text layer."
            ),
        )

    # ── save file to disk ────────────────────────────────────────────────────
    patient_dir = DOCS_DIR / patient_id
    patient_dir.mkdir(parents=True, exist_ok=True)
    unique_name = f"{uuid.uuid4().hex[:8]}_{filename}"
    dest_path   = patient_dir / unique_name
    dest_path.write_bytes(file_bytes)

    # ── Ollama extraction ────────────────────────────────────────────────────
    prompt = EXTRACTION_PROMPT.format(text=raw_text)
    print(f"[document_router] extracted text length: {len(raw_text)} chars", flush=True)
    print(f"[document_router] RAW OCR/TEXT-LAYER SOURCE handed to model:\n{raw_text}", flush=True)
    try:
        response = _ollama.chat(
            model=LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            options={"temperature": 0, "num_ctx": MODEL_NUM_CTX},
            **({"think": False} if THINKING_MODEL else {}),
        )
        raw_llm = response.message.content
        print(f"[document_router] raw LLM response (pre post-processing):\n{raw_llm}", flush=True)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Ollama unavailable: {e}")

    try:
        extracted = _extract_json(raw_llm)
    except (ValueError, json.JSONDecodeError):
        # Return what we got with a fallback structure
        extracted = {
            "document_type": "Unknown",
            "lab_results": [],
            "pending_investigations": [],
            "diagnoses": [],
            "medications": [],
            "vitals": [],
            "other_notes": raw_text[:500],
        }
    else:
        extracted = _apply_grounding(extracted, raw_text)

    # Attach the file path so the frontend can send it back in /save
    extracted["_file_path"] = str(dest_path)
    extracted["_filename"]  = unique_name

    return extracted


@router.post("/save")
async def save_document(body: SaveDocumentRequest):
    """Persist document metadata (filename, type, AI JSON) to the database."""
    try:
        doc = _save_doc(
            patient_id    = body.patient_id,
            filename      = body.filename,
            file_path     = body.file_path,
            document_type = body.document_type,
            extracted_json= body.extracted_json,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB save failed: {e}")

    # Make id and dates JSON-serialisable
    doc["id"]          = str(doc["id"])
    doc["uploaded_at"] = doc["uploaded_at"].isoformat() if doc.get("uploaded_at") else None
    return doc


@router.get("/{patient_id}")
async def list_documents(patient_id: str):
    """Return all documents uploaded for a patient, newest first."""
    try:
        docs = _list_docs(patient_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB read failed: {e}")

    for d in docs:
        d["id"]          = str(d["id"])
        d["uploaded_at"] = d["uploaded_at"].isoformat() if d.get("uploaded_at") else None
    return docs


@router.get("/file/{doc_id}")
async def serve_file(doc_id: str):
    """Serve the original uploaded file by document ID."""
    doc = _get_doc(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    path = Path(doc["file_path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing from disk")
    return FileResponse(str(path), filename=doc["filename"])
