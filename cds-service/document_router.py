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
import psycopg2
import psycopg2.extras
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

# ── configuration ──────────────────────────────────────────────────────────────

LLM_MODEL  = "llama3.2"
OLLAMA_URL = "http://localhost:11434"
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

def _extract_text_pdf(file_bytes: bytes) -> str:
    import io
    import pdfplumber
    text_parts = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                text_parts.append(t)
    return "\n\n".join(text_parts)


def _extract_text_docx(file_bytes: bytes) -> str:
    import io
    from docx import Document
    doc = Document(io.BytesIO(file_bytes))
    return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())


def _extract_text_image(file_bytes: bytes) -> str:
    import io
    import pytesseract
    from PIL import Image

    pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD
    img = Image.open(io.BytesIO(file_bytes))
    return pytesseract.image_to_string(img)


# ── JSON helpers (same pattern as existing CDS service) ──────────────────────

def _extract_json(text: str) -> dict:
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


EXTRACTION_PROMPT = """You are a medical document parser. Your job is to read the document text below and extract every piece of clinical data it contains — do not omit anything.

Return ONLY a valid JSON object with exactly this structure — no prose, no markdown, no explanation, just the JSON:
{{
  "document_type": "string (e.g. Lab Report, Discharge Summary, Prescription, Referral Letter, X-ray Report)",
  "lab_results": [
    {{"test_name": "string", "value": "string", "unit": "string", "reference_range": "string or empty", "flag": "string (Normal/High/Low/Critical or empty)"}}
  ],
  "diagnoses": ["string"],
  "medications": [
    {{"name": "string", "dose": "string", "route": "string or empty", "frequency": "string", "duration": "string or empty"}}
  ],
  "vitals": [
    {{"parameter": "string", "value": "string", "unit": "string", "date": "string or empty"}}
  ],
  "other_notes": "string"
}}

CRITICAL RULES — follow every one exactly:

LAB RESULTS:
- Extract EVERY individual test as a separate object. If the document lists 15 tests, your array must contain 15 objects.
- Sections like "Haematology", "Biochemistry", "Immunology" are headings — not tests. List every test under each heading individually.
- Copy the exact value and unit from the document. Do not round or reformat.
- Copy the reference range exactly as printed (e.g. "3.5-5.0" or "70-100 mg/dL").

DIAGNOSES:
- Copy each diagnosis exactly as it appears in the document — same spelling, same words.
- If the document lists 4 diagnoses, your array must contain 4 strings.
- Do NOT add diagnoses that are not written in the document.

MEDICATIONS:
- Extract EVERY medication, IV fluid, blood product, or supplement listed.
- Include name, dose, route (oral/IV/IM/etc.), frequency (OD/BD/TDS/etc.), and duration if stated.
- If a field is not mentioned, use an empty string — do not omit the object.

VITALS:
- Extract EVERY vital sign with its exact numeric value and unit as written.
- Valid parameters include: Blood Pressure (Systolic), Blood Pressure (Diastolic), Heart Rate, Temperature, SpO2, Respiratory Rate, Weight, Blood Glucose, and any others present.
- Copy values exactly from the document — do not substitute typical/normal values.

GENERAL:
- Use [] for sections with no data; "" for other_notes if empty.
- Never invent, infer, or hallucinate values. If you are not certain a value appears in the document, omit it.

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

router = APIRouter(prefix="/api/documents", tags=["documents"])


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

    # ── text extraction ──────────────────────────────────────────────────────
    try:
        if suffix == ".pdf" or "pdf" in content_type:
            raw_text = _extract_text_pdf(file_bytes)
        elif suffix in (".docx",) or "wordprocessingml" in content_type or "msword" in content_type:
            raw_text = _extract_text_docx(file_bytes)
        elif suffix in (".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp") or "image" in content_type:
            raw_text = _extract_text_image(file_bytes)
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type '{suffix}'. Upload a PDF, Word document, or image."
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Text extraction failed: {e}")

    if not raw_text.strip():
        raise HTTPException(status_code=422, detail="No text could be extracted from the document.")

    # ── save file to disk ────────────────────────────────────────────────────
    patient_dir = DOCS_DIR / patient_id
    patient_dir.mkdir(parents=True, exist_ok=True)
    unique_name = f"{uuid.uuid4().hex[:8]}_{filename}"
    dest_path   = patient_dir / unique_name
    dest_path.write_bytes(file_bytes)

    # ── Ollama extraction ────────────────────────────────────────────────────
    prompt = EXTRACTION_PROMPT.format(text=raw_text)
    print(f"[document_router] extracted text length: {len(raw_text)} chars", flush=True)
    try:
        response = _ollama.chat(
            model=LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            options={"temperature": 0},
        )
        raw_llm = response.message.content
        print(f"[document_router] raw LLM response:\n{raw_llm}", flush=True)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Ollama unavailable: {e}")

    try:
        extracted = _extract_json(raw_llm)
    except (ValueError, json.JSONDecodeError):
        # Return what we got with a fallback structure
        extracted = {
            "document_type": "Unknown",
            "lab_results": [],
            "diagnoses": [],
            "medications": [],
            "vitals": [],
            "other_notes": raw_text[:500],
        }

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
