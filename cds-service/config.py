"""
Shared configuration for the CDS service. The LLM model name is centralised
here (overridable via env var) so a model swap is a one-line/env change.
"""

import os

# Exact installed Ollama tag — confirm with `ollama list` after changing.
LLM_MODEL = os.getenv("CDS_LLM_MODEL", "llama3.2:latest")

# Explicit loopback, not OLLAMA_HOST: that env var is a *bind* address for the
# Ollama server (often 0.0.0.0), which is not a valid address to connect to.
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")

# Context window requested per call. Llama 3.2 supports far more, but 8k keeps
# memory modest on clinic laptops; the patient record (Express caps it at
# PATIENT_CONTEXT_CHAR_BUDGET) + guideline chunks + the JSON answer fit within it.
MODEL_NUM_CTX = int(os.getenv("CDS_NUM_CTX", "8192"))

# Only "thinking" models (Qwen 3, DeepSeek-R1, …) accept the think flag; sending
# it to Llama makes Ollama reject the request.
THINKING_MODEL = any(t in LLM_MODEL.lower() for t in ("qwen3", "deepseek-r1", "gpt-oss"))
