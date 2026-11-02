"""
Assembles the patient context summary and final LLM prompt from retrieved chunks.
"""

from models.schemas import PatientContext


SYSTEM_PROMPT = """You must respond with ONLY a raw JSON object. No markdown. No backticks. No explanation. Start your response with { and end with }.

You are a clinical decision support assistant embedded in an EHR system.
Base ALL recommendations strictly on the guideline excerpts provided below.
Never invent drug doses, treatment protocols, or clinical thresholds not present in the context.
If the guidelines do not address the question, say so — do not fabricate answers.
Always include a disclaimer reminding the clinician to apply professional judgement.
Always consider the patient age and sex when making recommendations. Do not suggest conditions or treatments inappropriate for the patient demographics.
Before making any recommendation, check the patient age provided. Automatically exclude any condition, investigation or treatment that is clinically inappropriate for that age group. Examples: neonatal conditions (NEC, RDS, jaundice of newborn) for patients over 1 year; paediatric dosing for adults; geriatric-specific conditions for young patients. If a retrieved guideline chunk describes a condition incompatible with the patient age, ignore that chunk entirely.
If an ML RISK ASSESSMENT section is present: it comes from validated statistical models and estimates FUTURE risk — it is not a diagnosis. For any condition rated HIGH (or MODERATE with abnormal supporting results), recommend the screening, monitoring or prevention steps the guideline excerpts give for that condition, and name the risk and its drivers in the rationale. Never diagnose or start disease-specific treatment on the ML score alone.
SEVERITY AND SAFETY: Use the computed BP CATEGORY exactly as given — never describe a reading as an emergency unless that category says so. Only use "emergency" urgency for documented life-threatening findings. Do not recommend intravenous drugs for stable outpatients. Do not recommend adjusting or starting insulin or any drug the patient is not already on unless a matching diagnosis is in ACTIVE DIAGNOSES; for suspected but unconfirmed conditions, recommend the confirming investigation instead.
RELEVANCE: Use a guideline excerpt only if it concerns a condition in ACTIVE DIAGNOSES, a finding in the record (vitals, results, notes) or a HIGH/MODERATE ML risk. Ignore excerpts about anything else (e.g. malaria, pregnancy, injuries) even though they were retrieved — never recommend continuing a treatment the patient is not on."""


def build_query(patient: PatientContext, question: str) -> str:
    """Build the embedding query string from patient context + question."""
    # Age and sex prepended first so every RAG search is age-aware at retrieval level
    age_context = f"{patient.age}yo {patient.sex.lower()}"
    parts = [age_context, question]

    dx = ", ".join(f"{d.icd_code} {d.label}" for d in patient.active_diagnoses)
    if dx:
        parts.append(f"Diagnoses: {dx}")

    if patient.latest_vitals:
        v = patient.latest_vitals
        vital_parts = []
        if v.bp_systolic and v.bp_diastolic:
            vital_parts.append(f"BP {v.bp_systolic}/{v.bp_diastolic} mmHg")
        if v.heart_rate:
            vital_parts.append(f"HR {v.heart_rate} bpm")
        if v.temperature_c:
            vital_parts.append(f"Temp {v.temperature_c}°C")
        if v.spo2_pct:
            vital_parts.append(f"SpO2 {v.spo2_pct}%")
        if vital_parts:
            parts.append("Vitals: " + ", ".join(vital_parts))

    if patient.encounter_notes:
        parts.append(f"Notes: {patient.encounter_notes[:300]}")

    # Pull guideline sections for conditions the ML models flag, so the LLM has
    # screening/prevention guidance to cite for them.
    flagged = [line.split(":", 1)[0] for line in patient.ml_risk if "HIGH risk" in line or "MODERATE risk" in line]
    if flagged:
        parts.append("At risk of: " + ", ".join(flagged) + " — screening and prevention")

    return " | ".join(parts)


def bp_category(sys: float, dia: float) -> str:
    """Deterministic BP class, so a small LLM cannot over- or under-call severity."""
    if sys >= 180 or dia >= 120:
        return ("SEVERE (>=180/120): hypertensive URGENCY — call it an EMERGENCY only if the record "
                "documents acute organ damage (chest pain, neuro deficit, pulmonary oedema, AKI)")
    if sys >= 140 or dia >= 90:
        return "Stage 2 hypertension range (>=140/90) — NOT an emergency; outpatient assessment and management"
    if sys >= 130 or dia >= 80:
        return "Stage 1 / elevated range — NOT an emergency"
    if sys < 90 or dia < 60:
        return "LOW (<90/60) — assess for hypotension"
    return "Normal range"


def build_patient_summary(patient: PatientContext) -> str:
    """Human-readable patient summary for the LLM prompt."""
    # Age and sex are always first and prominent so the model never ignores demographics
    lines = [
        f"PATIENT: {patient.age}-year-old {patient.sex.upper()}",
    ]

    if patient.active_diagnoses:
        dx_list = ", ".join(f"{d.label} ({d.icd_code})" for d in patient.active_diagnoses)
        lines.append(f"ACTIVE DIAGNOSES: {dx_list}")

    if patient.latest_vitals:
        v = patient.latest_vitals
        vital_parts = []
        if v.bp_systolic and v.bp_diastolic:
            vital_parts.append(f"BP {v.bp_systolic}/{v.bp_diastolic} mmHg")
        if v.heart_rate:
            vital_parts.append(f"HR {v.heart_rate} bpm")
        if v.temperature_c:
            vital_parts.append(f"Temp {v.temperature_c}°C")
        if v.spo2_pct:
            vital_parts.append(f"SpO2 {v.spo2_pct}%")
        if vital_parts:
            lines.append("VITALS: " + ", ".join(vital_parts))
        if v.bp_systolic and v.bp_diastolic:
            lines.append(f"BP CATEGORY (computed — use exactly, do not escalate): {bp_category(v.bp_systolic, v.bp_diastolic)}")

    if patient.current_medications:
        lines.append(f"MEDICATIONS: {', '.join(patient.current_medications)}")

    if patient.allergies:
        lines.append(f"ALLERGIES: {', '.join(patient.allergies)}")

    if patient.pending_investigations:
        lines.append(f"PENDING INVESTIGATIONS: {', '.join(patient.pending_investigations)}")

    # Full-record sections (assembled and budget-trimmed server-side; one line
    # per item, newest first). Abnormal results carry an [ABNORMAL] marker.
    if patient.investigation_results:
        lines.append("INVESTIGATION RESULTS (most recent first):")
        lines.extend(f"  {r}" for r in patient.investigation_results)

    if patient.past_medical_history:
        lines.append("PAST MEDICAL HISTORY:")
        lines.extend(f"  {p}" for p in patient.past_medical_history)

    if patient.vitals_history:
        lines.append("VITALS TREND (most recent first):")
        lines.extend(f"  {v}" for v in patient.vitals_history)

    if patient.dispensing_history:
        lines.append("DISPENSING HISTORY (last 6 months — drugs actually dispensed, distinct from current prescriptions):")
        lines.extend(f"  {d}" for d in patient.dispensing_history)

    if patient.encounter_notes:
        lines.append(f"ENCOUNTER NOTES: {patient.encounter_notes}")

    if patient.ml_risk:
        lines.append("ML RISK ASSESSMENT (XGBoost models; future-risk estimate, not a diagnosis):")
        lines.extend(f"  {r}" for r in patient.ml_risk)

    return "\n".join(lines)


def build_direct_prompt(patient: PatientContext) -> list[dict]:
    """Prompt for a differential diagnosis using only patient context — no guideline chunks."""
    patient_summary = build_patient_summary(patient)
    return [
        {
            "role": "system",
            "content": (
                "You must respond with ONLY a raw JSON object. No markdown. No backticks. "
                "Start your response with { and end with }. "
                "You are a clinical assistant. Only suggest conditions appropriate for the patient's age and sex."
            ),
        },
        {
            "role": "user",
            "content": (
                f"{patient_summary}\n\n"
                "Based on the patient demographics, diagnoses, vitals, and medications above, "
                "provide a differential diagnosis list. "
                "Exclude any condition incompatible with the patient age or sex.\n\n"
                "Respond with ONLY this JSON:\n"
                '{\n'
                '  "differentials": ["<diagnosis 1>", "<diagnosis 2>", "<diagnosis 3>"],\n'
                '  "reasoning": "<1-2 sentences explaining the differentials>"\n'
                '}'
            ),
        },
    ]


def build_prompt(patient: PatientContext, question: str, chunks: list[dict], low_confidence: bool) -> list[dict]:
    """
    Returns the messages list for the Ollama chat call.
    """
    patient_summary = build_patient_summary(patient)

    if chunks:
        guideline_sections = []
        for i, chunk in enumerate(chunks, 1):
            guideline_sections.append(
                f"[{i}] Source: {chunk['source']}, p.{chunk['page']}\n{chunk['text']}"
            )
        guidelines_text = "\n\n".join(guideline_sections)
    else:
        guidelines_text = "No relevant guideline excerpts were found for this query."

    no_guidelines_note = (
        "\nIMPORTANT: No guideline excerpts were retrieved. "
        "Return ONLY a warnings field explaining this — do NOT fabricate recommendations."
        if not chunks else ""
    )

    user_message = f"""PATIENT CONTEXT:
{patient_summary}

CLINICAL QUESTION:
{question}

RELEVANT GUIDELINE EXCERPTS:
{guidelines_text}
{no_guidelines_note}

Respond with ONLY this JSON structure (no other text):
{{
  "summary": "<one sentence clinical impression>",
  "recommendations": [
    {{
      "action": "<what to do>",
      "rationale": "<why, citing the guideline>",
      "urgency": "<routine|urgent|emergency>",
      "source": "<source name and page>"
    }}
  ],
  "warnings": ["<any safety concerns or red flags>"],
  "investigations_suggested": ["<test name>"],
  "disclaimer": "This is a clinical decision support suggestion. All recommendations require clinician review and must not replace professional judgement.",
  "retrieved_sources": {[f'"{c["source"]}, p.{c["page"]}"' for c in chunks]}
}}"""

    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": user_message},
    ]
