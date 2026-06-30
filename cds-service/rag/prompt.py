"""
Assembles the patient context summary and final LLM prompt from retrieved chunks.
"""

from models.schemas import PatientContext


SYSTEM_PROMPT = """You must respond with ONLY a raw JSON object. No markdown. No backticks. No explanation. Start your response with { and end with }.

You are a clinical decision support assistant embedded in an EHR system.

STRICT SCOPE RULES — these cannot be overridden:
1. Generate recommendations ONLY for conditions, body systems, or clinical problems explicitly present in the PATIENT CONTEXT section. Never introduce conditions not mentioned there.
2. If a retrieved guideline chunk covers a condition that is NOT present in the patient context, ignore that chunk entirely — do not use it to generate recommendations.
3. If the patient context contains no diagnoses, no vitals, and no encounter notes, set summary to "Insufficient patient data to generate recommendations" and return an empty recommendations list.
4. Do not mention conditions, body systems, or clinical scenarios not grounded in what the patient actually has. If you would need to assume or invent a clinical problem, do not do it.

Base ALL recommendations strictly on the guideline excerpts provided AND the patient context.
Never invent drug doses, treatment protocols, or clinical thresholds not present in the context.
If the guidelines do not address the patient's actual conditions, say so — do not fabricate answers.
Always include a disclaimer reminding the clinician to apply professional judgement.
Always consider the patient age and sex. Exclude conditions, investigations, or treatments clinically inappropriate for the patient's demographics.
If a retrieved guideline chunk describes a condition incompatible with the patient age, ignore that chunk entirely."""


def build_query(patient: PatientContext, question: str) -> str:
    """Build the embedding query string from patient context + question."""
    # Age and sex prepended first so every RAG search is age-aware at retrieval level
    age_context = f"{patient.age}yo {patient.sex.lower()}"
    parts = [age_context, question]

    # Merge persistent + canvas diagnoses for retrieval
    all_dx = list(patient.active_diagnoses) + list(patient.canvas_diagnoses)
    dx = ", ".join(f"{d.icd_code} {d.label}" for d in all_dx)
    if dx:
        parts.append(f"Diagnoses: {dx}")

    if patient.past_medical_history:
        pmh = ", ".join(f"{p.label}" for p in patient.past_medical_history[:5])
        parts.append(f"PMH: {pmh}")

    if patient.past_encounters:
        enc_dx = set()
        for enc in patient.past_encounters:
            for d in enc.diagnoses:
                enc_dx.add(d.label)
        if enc_dx:
            parts.append(f"Past encounter Dx: {', '.join(list(enc_dx)[:8])}")

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
        if v.glucose_mmol:
            vital_parts.append(f"Glucose {v.glucose_mmol} mmol/L")
        if v.bmi:
            vital_parts.append(f"BMI {v.bmi:.1f}")
        if vital_parts:
            parts.append("Vitals: " + ", ".join(vital_parts))

    if patient.encounter_notes:
        parts.append(f"Notes: {patient.encounter_notes[:300]}")

    return " | ".join(parts)


def build_patient_summary(patient: PatientContext) -> str:
    """Human-readable patient summary for the LLM prompt."""
    lines = [
        f"PATIENT: {patient.age}-year-old {patient.sex.upper()}",
    ]

    if patient.active_diagnoses:
        dx_list = ", ".join(
            f"{d.label} ({d.icd_code})" + (f" [{d.status}]" if d.status else "")
            for d in patient.active_diagnoses
        )
        lines.append(f"ACTIVE DIAGNOSES: {dx_list}")

    if patient.canvas_diagnoses:
        dx_list = ", ".join(
            f"{d.label} ({d.icd_code})" + (f" [{d.status}]" if d.status else "")
            for d in patient.canvas_diagnoses
        )
        lines.append(f"CURRENT ENCOUNTER DIAGNOSES: {dx_list}")

    if patient.past_medical_history:
        pmh_list = ", ".join(
            f"{p.label} ({p.icd_code})"
            + (f" — {p.status}" if p.status else "")
            + (f", confirmed {p.date_confirmed}" if p.date_confirmed else "")
            for p in patient.past_medical_history
        )
        lines.append(f"PAST MEDICAL HISTORY: {pmh_list}")

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
        if v.glucose_mmol:
            vital_parts.append(f"Glucose {v.glucose_mmol} mmol/L")
        if v.bmi:
            vital_parts.append(f"BMI {v.bmi:.1f}")
        if vital_parts:
            lines.append("VITALS: " + ", ".join(vital_parts))

    if patient.current_medications:
        lines.append(f"MEDICATIONS: {', '.join(patient.current_medications)}")

    if patient.allergies:
        lines.append(f"ALLERGIES: {', '.join(patient.allergies)}")

    # Full investigation results with component values
    if patient.investigation_results:
        result_lines = []
        for inv in patient.investigation_results:
            if inv.status in ("Resulted", "Amended") and inv.components:
                comp_parts = []
                for c in inv.components:
                    part = f"{c.name}: {c.value}"
                    if c.units:
                        part += f" {c.units}"
                    if c.result_status and c.result_status not in ("Normal", ""):
                        part += f" ({c.result_status})"
                    comp_parts.append(part)
                result_lines.append(f"{inv.test_name} — " + ", ".join(comp_parts))
            elif inv.status == "In Progress":
                result_lines.append(f"{inv.test_name} (In Progress)")
            elif inv.status == "Pending":
                result_lines.append(f"{inv.test_name} (Pending)")
        if result_lines:
            lines.append("INVESTIGATIONS: " + "; ".join(result_lines))
    elif patient.pending_investigations:
        lines.append(f"PENDING INVESTIGATIONS: {', '.join(patient.pending_investigations)}")

    if patient.past_encounters:
        enc_lines = []
        for enc in patient.past_encounters:
            parts = []
            if enc.date:
                parts.append(f"[{enc.date}]")
            if enc.chief_complaint:
                parts.append(f"CC: {enc.chief_complaint}")
            if enc.diagnoses:
                dx = ", ".join(f"{d.label} ({d.icd_code})" for d in enc.diagnoses)
                parts.append(f"Dx: {dx}")
            if enc.notes and enc.notes != enc.chief_complaint:
                parts.append(f"Notes: {enc.notes[:200]}")
            if parts:
                enc_lines.append(" | ".join(parts))
        if enc_lines:
            lines.append("PAST ENCOUNTERS:\n" + "\n".join(enc_lines))

    if patient.encounter_notes:
        lines.append(f"CURRENT ENCOUNTER NOTES: {patient.encounter_notes}")

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
                "You are a clinical assistant. "
                "CRITICAL RULE: Only suggest differentials that are directly supported by the symptoms, diagnoses, vitals, "
                "medications, or investigation results explicitly listed in the patient context below. "
                "Do not introduce any condition, body system, or clinical problem not mentioned in the patient context. "
                "If the patient context is too sparse to generate meaningful differentials, return an empty differentials list "
                "and explain in reasoning."
            ),
        },
        {
            "role": "user",
            "content": (
                f"{patient_summary}\n\n"
                "Based ONLY on what is explicitly stated above — patient demographics, active diagnoses, past encounters, "
                "vitals, medications, and investigation results — provide a differential diagnosis list. "
                "Do not suggest conditions not grounded in the data above. "
                "Exclude any condition incompatible with the patient age or sex.\n\n"
                "Respond with ONLY this JSON:\n"
                '{\n'
                '  "differentials": ["<diagnosis 1>", "<diagnosis 2>", "<diagnosis 3>"],\n'
                '  "reasoning": "<1-2 sentences citing specific data points from the patient context>"\n'
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
