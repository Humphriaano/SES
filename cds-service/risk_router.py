"""
risk_router.py
Exposes POST /cds/risk-predict — receives patient feature values
from the React frontend and returns four risk scores with SHAP
explanations and plain language clinical comments.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from risk_model import predict

router = APIRouter()


# ── request schema ────────────────────────────────────────────────────────────
# All fields are optional — missing values are handled as NaN by XGBoost
# Field names match exactly the feature_cols.json column names

class RiskRequest(BaseModel):
    # Demographics
    age:                          Optional[float] = None
    gender:                       Optional[float] = None
    bmi:                          Optional[float] = None
    waist_cm:                     Optional[float] = None

    # Lifestyle
    smoking_status:               Optional[float] = None
    pack_years:                   Optional[float] = None
    alcohol_units_per_week:       Optional[float] = None
    physical_activity_hrs_week:   Optional[float] = None
    dietary_quality:              Optional[float] = None

    # Family history
    fhx_hypertension:             Optional[float] = None
    fhx_diabetes:                 Optional[float] = None
    fhx_cvd:                      Optional[float] = None
    fhx_ckd:                      Optional[float] = None
    fhx_cancer:                   Optional[float] = None

    # Clinical history
    hiv_status:                   Optional[float] = None
    on_art:                       Optional[float] = None
    prev_cvd_event:               Optional[float] = None
    gestational_diabetes:         Optional[float] = None

    # Blood pressure
    bp_reading1:                  Optional[float] = None
    bp_reading2:                  Optional[float] = None
    bp_visit_avg:                 Optional[float] = None
    bp_3visit_avg:                Optional[float] = None
    bp_6month_avg:                Optional[float] = None
    bp_12month_max:               Optional[float] = None
    bp_trend:                     Optional[float] = None
    bp_variability:               Optional[float] = None
    elevated_visit_count:         Optional[float] = None

    # Glucose
    fasting_glucose_mmol:         Optional[float] = None
    rbs_mmol:                     Optional[float] = None
    hba1c_pct:                    Optional[float] = None

    # Lipids
    total_cholesterol_mmol:       Optional[float] = None
    ldl_mmol:                     Optional[float] = None
    hdl_mmol:                     Optional[float] = None
    triglycerides_mmol:           Optional[float] = None
    non_hdl_mmol:                 Optional[float] = None
    tc_hdl_ratio:                 Optional[float] = None
    tg_hdl_ratio:                 Optional[float] = None

    # Kidney
    creatinine_umol:              Optional[float] = None
    egfr:                         Optional[float] = None
    urea_mmol:                    Optional[float] = None
    microalbumin_mg_l:            Optional[float] = None
    sodium_mmol:                  Optional[float] = None
    potassium_mmol:               Optional[float] = None

    # Liver
    alt_u_l:                      Optional[float] = None
    ast_u_l:                      Optional[float] = None
    ggt_u_l:                      Optional[float] = None

    # Inflammatory
    crp_mg_l:                     Optional[float] = None
    esr_mm_hr:                    Optional[float] = None

    # Full blood count
    haemoglobin_g_dl:             Optional[float] = None
    wbc_x10_9:                    Optional[float] = None
    platelets_x10_9:              Optional[float] = None

    # Thyroid
    tsh_miu_l:                    Optional[float] = None

    # Other
    uric_acid_umol:               Optional[float] = None
    consult_count_12m:            Optional[float] = None


# ── endpoint ──────────────────────────────────────────────────────────────────

@router.post("/cds/risk-predict")
async def risk_predict(req: RiskRequest):
    """
    Receives patient feature values and returns four chronic disease
    risk predictions — hypertension, cardiovascular, diabetes, and CKD —
    each with a probability score, risk level, top SHAP drivers,
    and a plain language clinical summary.
    """
    try:
        # Convert request to plain dictionary
        # None values stay as None — predict() converts them to NaN
        patient_data = req.model_dump()

        # Run prediction
        result = predict(patient_data)

        return {
            "status":      "ok",
            "predictions": result
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Risk prediction failed: {str(e)}"
        )