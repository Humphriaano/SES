from pydantic import BaseModel, Field
from typing import Optional


class LatestVitals(BaseModel):
    bp_systolic: Optional[float] = None
    bp_diastolic: Optional[float] = None
    heart_rate: Optional[float] = None
    temperature_c: Optional[float] = None
    spo2_pct: Optional[float] = None


class ActiveDiagnosis(BaseModel):
    icd_code: str
    label: str


class PatientContext(BaseModel):
    age: int
    sex: str
    patient_id: str
    active_diagnoses: list[ActiveDiagnosis] = []
    current_medications: list[str] = []
    allergies: list[str] = []
    latest_vitals: Optional[LatestVitals] = None
    pending_investigations: list[str] = []
    encounter_notes: str = ""
    # Full-record sections assembled server-side by Express (terse one-line-
    # per-item strings, already budget-trimmed there). All optional so older
    # callers that omit them keep working.
    investigation_results: list[str] = []
    past_medical_history: list[str] = []
    vitals_history: list[str] = []
    dispensing_history: list[str] = []
    # XGBoost chronic-disease risk (one line per condition: level, %, top
    # SHAP drivers), attached by Express from /cds/risk-predict.
    ml_risk: list[str] = []


class CdsRequest(BaseModel):
    question: str
    patient: PatientContext


class Recommendation(BaseModel):
    action: str
    rationale: str
    urgency: str  # "routine" | "urgent" | "emergency"
    source: str


class CdsResponse(BaseModel):
    summary: str
    recommendations: list[Recommendation] = []
    warnings: list[str] = []
    investigations_suggested: list[str] = []
    disclaimer: str
    retrieved_sources: list[str] = []
    low_confidence: bool = False
    error: Optional[str] = None
    direct_suggestion: Optional[str] = None
    # Echo of the ML risk lines the LLM was given, and which LLM answered.
    ml_risk: list[str] = []
    model: Optional[str] = None
