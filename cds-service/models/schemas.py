from pydantic import BaseModel, Field
from typing import Optional


class LatestVitals(BaseModel):
    bp_systolic: Optional[float] = None
    bp_diastolic: Optional[float] = None
    heart_rate: Optional[float] = None
    temperature_c: Optional[float] = None
    spo2_pct: Optional[float] = None
    glucose_mmol: Optional[float] = None
    bmi: Optional[float] = None
    weight_kg: Optional[float] = None
    height_cm: Optional[float] = None


class ActiveDiagnosis(BaseModel):
    icd_code: str
    label: str
    status: str = ""   # e.g. "Confirmed", "Suspected", "Chronic"


class PMHEntry(BaseModel):
    icd_code: str
    label: str
    status: str = ""
    date_confirmed: str = ""


class InvestigationComponent(BaseModel):
    name: str
    value: str = ""
    units: str = ""
    reference_range: str = ""
    result_status: str = ""   # e.g. "Normal", "High", "Low", "Abnormal"


class InvestigationResult(BaseModel):
    test_name: str
    status: str           # "Resulted" | "Amended" | "In Progress" | "Pending"
    specimen: str = ""
    components: list[InvestigationComponent] = []


class PastEncounterDx(BaseModel):
    icd_code: str
    label: str


class PastEncounter(BaseModel):
    date: str = ""
    chief_complaint: str = ""
    diagnoses: list[PastEncounterDx] = []
    notes: str = ""


class PatientContext(BaseModel):
    age: int
    sex: str
    patient_id: str
    active_diagnoses: list[ActiveDiagnosis] = []        # chronic / persistent conditions from DB
    canvas_diagnoses: list[ActiveDiagnosis] = []        # Dx blocks added this session
    past_medical_history: list[PMHEntry] = []           # PMH blocks from canvas
    past_encounters: list[PastEncounter] = []           # closed encounter summaries
    current_medications: list[str] = []
    allergies: list[str] = []
    latest_vitals: Optional[LatestVitals] = None
    pending_investigations: list[str] = []
    investigation_results: list[InvestigationResult] = []
    encounter_notes: str = ""


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
