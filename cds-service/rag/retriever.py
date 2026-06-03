"""
Retrieves the top-k most relevant guideline chunks from ChromaDB for a given query.
"""

from pathlib import Path
from typing import Optional

import chromadb
from chromadb.utils.embedding_functions import OllamaEmbeddingFunction

CHROMA_DIR  = Path(__file__).parent.parent / "chroma_db"
EMBED_MODEL = "nomic-embed-text"
OLLAMA_URL  = "http://localhost:11434"
COLLECTION  = "guidelines"
TOP_K       = 5
LOW_CONF_THRESHOLD = 0.30  # cosine distance — below this = low confidence

PAEDIATRIC_KEYWORDS = [
    'children', 'child', 'infant', 'neonatal', 'neonate',
    'newborn', 'paediatric', 'pediatric',
]


def filter_chunks_by_age(chunks: list[dict], patient_age: int) -> list[dict]:
    """Remove age-inappropriate chunks before sending to the model."""
    if patient_age >= 18:
        return [
            c for c in chunks
            if not any(kw in c['text'].lower() for kw in PAEDIATRIC_KEYWORDS)
        ]
    return chunks


def get_collection():
    embed_fn = OllamaEmbeddingFunction(
        url=f"{OLLAMA_URL}/api/embeddings",
        model_name=EMBED_MODEL,
    )
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    return client.get_or_create_collection(
        name=COLLECTION,
        embedding_function=embed_fn,
        metadata={"hnsw:space": "cosine"},
    )


def retrieve(query: str, top_k: int = TOP_K) -> dict:
    """
    Returns:
        {
            "chunks": [{"text": ..., "source": ..., "page": ...}, ...],
            "low_confidence": bool,
            "sources": [str, ...]   # unique source names
        }
    """
    collection = get_collection()

    if collection.count() == 0:
        return {"chunks": [], "low_confidence": True, "sources": []}

    results = collection.query(
        query_texts=[query],
        n_results=min(top_k, collection.count()),
        include=["documents", "metadatas", "distances"],
    )

    chunks = []
    min_distance = float("inf")

    docs      = results["documents"][0]
    metas     = results["metadatas"][0]
    distances = results["distances"][0]

    for text, meta, dist in zip(docs, metas, distances):
        if dist < min_distance:
            min_distance = dist
        chunks.append({
            "text":   text,
            "source": meta.get("source", "Unknown"),
            "page":   meta.get("page", "?"),
        })

    # cosine distance: 0 = identical, 2 = opposite.
    # A distance > (1 - LOW_CONF_THRESHOLD) means low similarity.
    low_confidence = min_distance > (1 - LOW_CONF_THRESHOLD)

    sources = list(dict.fromkeys(
        f"{c['source']} (p.{c['page']})" for c in chunks
    ))

    return {
        "chunks":         chunks,
        "low_confidence": low_confidence,
        "sources":        sources,
    }


def doc_count() -> int:
    try:
        return get_collection().count()
    except Exception:
        return 0
