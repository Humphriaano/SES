"""
PDF ingestion pipeline → ChromaDB
Run: python rag/ingest.py
Drop PDFs in cds-service/guidelines/ before running.
"""

import os
import sys
import re
from pathlib import Path

import chromadb
from chromadb.utils.embedding_functions import OllamaEmbeddingFunction
from pypdf import PdfReader

GUIDELINES_DIR = Path(__file__).parent.parent / "guidelines"
CHROMA_DIR     = Path(__file__).parent.parent / "chroma_db"
EMBED_MODEL    = "nomic-embed-text"
sys.path.insert(0, str(Path(__file__).parent.parent))  # so `python rag/ingest.py` finds config.py
from config import OLLAMA_URL  # noqa: E402  (single source of truth)
CHUNK_SIZE     = 512
CHUNK_OVERLAP  = 64
COLLECTION     = "guidelines"


def split_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """RecursiveCharacterTextSplitter-style splitting on paragraph → sentence → word boundaries."""
    # Try to split on double newlines first, then single, then spaces
    separators = ["\n\n", "\n", " ", ""]

    def _split(text: str, separators: list[str]) -> list[str]:
        sep = separators[0]
        remaining = separators[1:]
        if not sep:
            return [text[i:i+chunk_size] for i in range(0, len(text), chunk_size - overlap)]
        parts = text.split(sep)
        chunks, current = [], ""
        for part in parts:
            if len(current) + len(sep) + len(part) <= chunk_size:
                current += (sep if current else "") + part
            else:
                if current:
                    chunks.append(current)
                if len(part) > chunk_size and remaining:
                    chunks.extend(_split(part, remaining))
                else:
                    current = part
        if current:
            chunks.append(current)
        return chunks

    raw = _split(text.strip(), separators)
    # Re-merge tiny fragments and apply sliding overlap
    merged, i = [], 0
    while i < len(raw):
        chunk = raw[i]
        # slide: prepend tail of previous chunk for context overlap
        if i > 0 and len(raw[i-1]) >= overlap:
            chunk = raw[i-1][-overlap:] + " " + chunk
        merged.append(chunk[:chunk_size])
        i += 1
    return [c for c in merged if len(c.strip()) > 30]


def load_pdf(path: Path) -> list[dict]:
    """Return list of {text, page, source} dicts."""
    reader = PdfReader(str(path))
    pages = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            pages.append({"text": text, "page": i + 1, "source": path.name})
    return pages


def ingest():
    pdfs = sorted(GUIDELINES_DIR.glob("*.pdf"))
    if not pdfs:
        print(f"No PDFs found in {GUIDELINES_DIR}. Drop guidelines there and re-run.")
        return

    embed_fn = OllamaEmbeddingFunction(
        url=f"{OLLAMA_URL}/api/embeddings",
        model_name=EMBED_MODEL,
    )

    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    collection = client.get_or_create_collection(
        name=COLLECTION,
        embedding_function=embed_fn,
        metadata={"hnsw:space": "cosine"},
    )

    existing_sources = set()
    try:
        existing = collection.get(include=["metadatas"])
        for m in existing["metadatas"]:
            existing_sources.add(m.get("source", ""))
    except Exception:
        pass

    total_added = 0

    for pdf in pdfs:
        if pdf.name in existing_sources:
            print(f"  ↳ {pdf.name} already ingested — skipping")
            continue

        print(f"\nIngesting {pdf.name}…")
        pages = load_pdf(pdf)
        if not pages:
            print(f"  ↳ No text extracted — skipping")
            continue

        doc_ids, doc_texts, doc_metas = [], [], []
        chunk_idx = 0
        for page_data in pages:
            chunks = split_text(page_data["text"])
            for chunk in chunks:
                doc_ids.append(f"{pdf.stem}__p{page_data['page']}__c{chunk_idx}")
                doc_texts.append(chunk)
                doc_metas.append({
                    "source": pdf.name,
                    "page": page_data["page"],
                })
                chunk_idx += 1

        # Batch insert
        BATCH = 50
        for start in range(0, len(doc_ids), BATCH):
            batch_ids   = doc_ids[start:start + BATCH]
            batch_texts = doc_texts[start:start + BATCH]
            batch_metas = doc_metas[start:start + BATCH]
            collection.upsert(ids=batch_ids, documents=batch_texts, metadatas=batch_metas)
            done = min(start + BATCH, len(doc_ids))
            print(f"  {done}/{len(doc_ids)} chunks embedded…", end="\r")

        print(f"  ✓ {len(doc_ids)} chunks from {pdf.name}")
        total_added += len(doc_ids)

    print(f"\nDone — {total_added} chunks added. Collection size: {collection.count()} total.")


if __name__ == "__main__":
    # Allow running from the project root too
    if str(Path(__file__).parent.parent) not in sys.path:
        sys.path.insert(0, str(Path(__file__).parent.parent))
    ingest()
