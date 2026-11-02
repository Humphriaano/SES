"""
risk_model.py
Loads the four XGBoost chronic disease risk models at startup
and exposes a single predict() function for the risk router.
"""

import json
import numpy as np
import xgboost as xgb
from pathlib import Path

# ── paths ─────────────────────────────────────────────────────────────────────
# All model files live in the models/ folder inside cds-service
# Change this path if you move the models folder

MODELS_DIR = Path(__file__).parent / "models"

# ── load feature column order ─────────────────────────────────────────────────
# This is the contract — patient data must be arranged in exactly this order
# before being fed to any of the four models

with open(MODELS_DIR / "feature_cols.json") as f:
    FEATURE_COLS = json.load(f)

print(f"Loaded {len(FEATURE_COLS)} feature columns", flush=True)

# ── load the four models ───────────────────────────────────────────────────────
# We use xgb.Booster directly — this is what get_booster().save_model() produces
# Each model is loaded once at startup and stays in memory

model_htn = xgb.Booster()
model_htn.load_model(str(MODELS_DIR / "model_hypertension.json"))
print("Loaded: model_hypertension", flush=True)

model_cvd = xgb.Booster()
model_cvd.load_model(str(MODELS_DIR / "model_cvd.json"))
print("Loaded: model_cvd", flush=True)

model_dm = xgb.Booster()
model_dm.load_model(str(MODELS_DIR / "model_diabetes.json"))
print("Loaded: model_diabetes", flush=True)

model_ckd = xgb.Booster()
model_ckd.load_model(str(MODELS_DIR / "model_ckd.json"))
print("Loaded: model_ckd", flush=True)

print("All four risk models ready", flush=True)

# ── risk level thresholds ─────────────────────────────────────────────────────
# These convert the raw probability into a clinical risk level
# Thresholds are clinically defined — not statistical

def get_risk_level(prob: float) -> str:
    if prob >= 0.85:   return "very high"
    elif prob >= 0.70: return "high"
    elif prob >= 0.40: return "moderate"
    else:              return "low"


# ── SHAP comment templates ────────────────────────────────────────────────────
# Pre-written clinical sentences keyed on feature name and direction
# {value} is replaced with the patient's actual value at runtime

COMMENT_TEMPLATES = {
    "bp_visit_avg": {
        "up":   "Blood pressure of {value} mmHg is the primary driver of risk",
        "down": "Blood pressure of {value} mmHg is within acceptable range"
    },
    "bp_3visit_avg": {
        "up":   "Sustained elevated BP averaging {value} mmHg across visits confirms persistent hypertension",
        "down": "BP has been consistently controlled across recent visits"
    },
    "elevated_visit_count": {
        "up":   "BP was elevated in {value} out of recent visits indicating uncontrolled hypertension",
        "down": "Few visits with elevated BP suggesting good BP control"
    },
    "fasting_glucose_mmol": {
        "up":   "Fasting glucose of {value} mmol/L indicates elevated metabolic risk",
        "down": "Fasting glucose of {value} mmol/L is within normal range"
    },
    "hba1c_pct": {
        "up":   "HbA1c of {value}% reflects poor glycaemic control over the past 3 months",
        "down": "HbA1c of {value}% reflects good long-term glucose control"
    },
    "rbs_mmol": {
        "up":   "Random blood sugar of {value} mmol/L is above safe threshold",
        "down": "Random blood sugar of {value} mmol/L is acceptable"
    },
    "bmi": {
        "up":   "BMI of {value} kg/m² indicates overweight or obesity contributing to risk",
        "down": "BMI of {value} kg/m² is within healthy range"
    },
    "egfr": {
        "up":   "eGFR of {value} mL/min suggests adequate kidney filtration",
        "down": "eGFR of {value} mL/min indicates reduced kidney function"
    },
    "creatinine_umol": {
        "up":   "Elevated creatinine of {value} μmol/L signals kidney stress",
        "down": "Creatinine of {value} μmol/L is within normal range"
    },
    "microalbumin_mg_l": {
        "up":   "Microalbumin of {value} mg/L indicates early kidney damage",
        "down": "Microalbumin of {value} mg/L is within normal range"
    },
    "total_cholesterol_mmol": {
        "up":   "Total cholesterol of {value} mmol/L elevates cardiovascular risk",
        "down": "Total cholesterol of {value} mmol/L is within acceptable range"
    },
    "tc_hdl_ratio": {
        "up":   "Cholesterol to HDL ratio of {value} indicates high cardiovascular risk",
        "down": "Cholesterol to HDL ratio of {value} is within safe range"
    },
    "hdl_mmol": {
        "up":   "HDL of {value} mmol/L provides some cardiovascular protection",
        "down": "Low HDL of {value} mmol/L increases cardiovascular risk"
    },
    "crp_mg_l": {
        "up":   "CRP of {value} mg/L indicates chronic inflammation driving risk",
        "down": "CRP of {value} mg/L suggests low systemic inflammation"
    },
    "hiv_status": {
        "up":   "HIV positive status independently elevates cardiovascular and kidney risk",
        "down": "HIV negative status — no HIV-related risk contribution"
    },
    "on_art": {
        "up":   "ART treatment adds metabolic and cardiovascular risk burden",
        "down": "Not on ART — no ART-related risk contribution"
    },
    "smoking_status": {
        "up":   "Current or former smoking history contributes to vascular risk",
        "down": "Non-smoker — no smoking-related risk contribution"
    },
    "physical_activity_hrs_week": {
        "up":   "Physical activity level is partially protective",
        "down": "Low physical activity is contributing to risk"
    },
    "age": {
        "up":   "Age of {value} years places this patient in an elevated risk group",
        "down": "Younger age is partially protective"
    },
    "fhx_hypertension": {
        "up":   "Positive family history of hypertension increases genetic risk",
        "down": "No family history of hypertension — lower genetic risk"
    },
    "fhx_diabetes": {
        "up":   "Family history of diabetes increases progression risk",
        "down": "No family history of diabetes"
    },
    "fhx_cvd": {
        "up":   "Family history of cardiovascular disease increases risk",
        "down": "No family history of cardiovascular disease"
    },
    "fhx_ckd": {
        "up":   "Family history of kidney disease increases CKD risk",
        "down": "No family history of kidney disease"
    },
    "waist_cm": {
        "up":   "Waist circumference of {value} cm indicates central obesity",
        "down": "Waist circumference of {value} cm is within healthy range"
    },
    "bp_trend": {
        "up":   "Blood pressure is trending upward across recent visits",
        "down": "Blood pressure trend is stable or improving"
    },
}

def get_comment(feature: str, direction: str, value: float) -> str:
    # Look up the template for this feature and direction
    # Fall back to a generic sentence if no template exists
    template = COMMENT_TEMPLATES.get(feature, {}).get(direction)
    if template:
        try:
            return template.format(value=round(value, 1))
        except Exception:
            return template
    return f"{feature.replace('_', ' ')} is {'elevated' if direction == 'up' else 'within range'}"


# ── main predict function ─────────────────────────────────────────────────────

def predict(patient_data: dict) -> dict:
    """
    Receives a dictionary of patient feature values.
    Missing features are filled with NaN — XGBoost handles them natively.
    Returns risk scores, levels, SHAP explanations, and clinical comments
    for all four conditions.
    """

    # 1. Arrange patient data in correct feature order
    # Any missing feature becomes NaN
    values = [patient_data.get(col) for col in FEATURE_COLS]
    values = [np.nan if v is None else v for v in values]
    arr = np.array(values, dtype=np.float32).reshape(1, -1)

    # 2. Convert to XGBoost DMatrix — the format the Booster expects
    dmatrix = xgb.DMatrix(arr, feature_names=FEATURE_COLS)

    # 3. Get raw predictions from all four models
    # Booster.predict returns margin scores — convert to probability with sigmoid
    def sigmoid(x):
        return 1 / (1 + np.exp(-x))

    prob_htn = float(sigmoid(model_htn.predict(dmatrix)[0]))
    prob_cvd = float(sigmoid(model_cvd.predict(dmatrix)[0]))
    prob_dm  = float(sigmoid(model_dm.predict(dmatrix)[0]))
    prob_ckd = float(sigmoid(model_ckd.predict(dmatrix)[0]))

    # 4. Calculate SHAP values for each model
    def get_shap_explanation(model, arr):
        # Get SHAP contribution scores for this patient
        shap_raw = model.predict(dmatrix, pred_contribs=True)[0]

        # Last value is the bias term — exclude it
        shap_features = shap_raw[:-1]

        # Pair each feature with its SHAP value and patient value
        pairs = list(zip(FEATURE_COLS, shap_features, values))

        # Only features actually on record can be explained to a clinician: a
        # missing value still shifts the tree's output, but a sentence like
        # "eGFR of 0 mL/min" for a test never done is wrong and misleading.
        present = [p for p in pairs if p[2] is not None and not np.isnan(p[2])]

        # Sort by absolute SHAP value — strongest contributors first
        pairs_sorted = sorted(present, key=lambda x: abs(x[1]), reverse=True)

        # Take top 3
        top3 = []
        for feat, shap_val, pat_val in pairs_sorted[:3]:
            direction = "up" if shap_val > 0 else "down"
            top3.append({
                "feature":   feat,
                "value":     round(float(pat_val), 2),
                "impact":    round(float(shap_val), 3),
                "direction": "increases_risk" if shap_val > 0 else "decreases_risk",
                "comment":   get_comment(feat, direction, pat_val)
            })
        return top3

    shap_htn = get_shap_explanation(model_htn, arr)
    shap_cvd = get_shap_explanation(model_cvd, arr)
    shap_dm  = get_shap_explanation(model_dm,  arr)
    shap_ckd = get_shap_explanation(model_ckd, arr)

    # 5. Build plain language summary for each condition
    def build_summary(condition: str, prob: float, shap: list) -> str:
        level = get_risk_level(prob)
        drivers = [s["comment"] for s in shap if s["direction"] == "increases_risk"]
        protective = [s["comment"] for s in shap if s["direction"] == "decreases_risk"]

        if not drivers:
            return f"{condition} risk is {level} ({prob*100:.0f}%). No major risk drivers identified."

        driver_text = drivers[0]
        if len(drivers) > 1:
            driver_text += f", and {drivers[1].lower()}"

        summary = f"{condition} risk is {level} ({prob*100:.0f}%). {driver_text}."
        if protective:
            summary += f" Note: {protective[0].lower()}."
        return summary

    # 6. Return complete prediction result
    return {
        "hypertension": {
            "probability": round(prob_htn, 3),
            "risk_level":  get_risk_level(prob_htn),
            "top_factors": shap_htn,
            "summary":     build_summary("Hypertension", prob_htn, shap_htn)
        },
        "cardiovascular": {
            "probability": round(prob_cvd, 3),
            "risk_level":  get_risk_level(prob_cvd),
            "top_factors": shap_cvd,
            "summary":     build_summary("Cardiovascular", prob_cvd, shap_cvd)
        },
        "diabetes": {
            "probability": round(prob_dm, 3),
            "risk_level":  get_risk_level(prob_dm),
            "top_factors": shap_dm,
            "summary":     build_summary("Diabetes", prob_dm, shap_dm)
        },
        "ckd": {
            "probability": round(prob_ckd, 3),
            "risk_level":  get_risk_level(prob_ckd),
            "top_factors": shap_ckd,
            "summary":     build_summary("CKD", prob_ckd, shap_ckd)
        }
    }