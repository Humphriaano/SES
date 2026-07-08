"""
Shared configuration for the CDS service. The LLM model name is centralised
here (overridable via env var) so a model swap is a one-line/env change.
"""

import os

# Exact installed Ollama tag — confirm with `ollama list` after changing.
LLM_MODEL = os.getenv("CDS_LLM_MODEL", "qwen3.6:latest")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")

# Qwen 3.6 runs with num_ctx 32768 in Ollama (native window is larger, but
# 32k is what the runtime allocates). The patient-record section of the CDS
# prompt is budgeted well under that so guideline chunks + generation always
# fit; the Express aggregation endpoint enforces PATIENT_CONTEXT_CHAR_BUDGET.
MODEL_NUM_CTX = 32768
