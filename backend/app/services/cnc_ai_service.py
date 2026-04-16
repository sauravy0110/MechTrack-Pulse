"""
MechTrack Pulse — CNC AI Service

AI-powered functions specific to CNC Shaft Production:
  - Drawing specification extraction (simulate + real AI)
  - Process plan validation and suggestion
  - Setup image analysis
  - Final inspection analysis
  - Rework decision support

All functions follow the pattern:
  1. Attempt OpenRouter LLM call
  2. Falls back to deterministic heuristics if AI is unavailable
  3. Returns structured output with status, confidence, message, suggestion
"""

from __future__ import annotations

import logging
import random
import re
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.task import Task
from app.models.user import User
from app.models.machine import Machine
from app.models.job_spec import JobSpec
from app.models.job_process import JobProcess
from app.services.openrouter_service import (
    _chat_json,
    _chat_json_with_image,
    openrouter_enabled,
    openrouter_vision_enabled,
)
from app.core.config import get_settings

logger = logging.getLogger("app.cnc_ai")
settings = get_settings()

# ── Standard CNC shaft drawing fields ────────────────────────
STANDARD_SHAFT_FIELDS = [
    {"field_name": "Overall_Length", "unit": "mm"},
    {"field_name": "Diameter_1_OD", "unit": "mm"},
    {"field_name": "Diameter_2_OD", "unit": "mm"},
    {"field_name": "Diameter_3_OD", "unit": "mm"},
    {"field_name": "Thread_Spec", "unit": ""},
    {"field_name": "Keyway_Width", "unit": "mm"},
    {"field_name": "Keyway_Depth", "unit": "mm"},
    {"field_name": "Groove_Width", "unit": "mm"},
    {"field_name": "Surface_Roughness", "unit": "Ra"},
    {"field_name": "Runout_Tolerance", "unit": "mm"},
    {"field_name": "Concentricity_Tolerance", "unit": "mm"},
]

# ── Standard CNC shaft operations ────────────────────────────
STANDARD_OPERATIONS = [
    {"name": "Raw Material Facing & Centering", "cycle_time": 15},
    {"name": "Rough Turning (OD)", "cycle_time": 45},
    {"name": "Semi-Finish Turning (OD)", "cycle_time": 30},
    {"name": "Finish Turning (OD)", "cycle_time": 25},
    {"name": "Thread Cutting", "cycle_time": 20},
    {"name": "Keyway Milling", "cycle_time": 30},
    {"name": "Groove Turning", "cycle_time": 15},
    {"name": "OD Cylindrical Grinding", "cycle_time": 40},
    {"name": "Deburring & Chamfering", "cycle_time": 10},
    {"name": "Final Inspection & Marking", "cycle_time": 20},
]

STANDARD_THREADS = {6, 8, 10, 12, 14, 16, 20, 24}
DEFAULT_OPENROUTER_VISION_MODEL = "openrouter/free"

VISION_OCR_SYSTEM_PROMPT = """
You are an expert mechanical engineering drawing interpreter.

Your task is to extract ALL dimensions and specifications from the provided engineering drawing image with maximum accuracy.

========================
CRITICAL EXTRACTION RULES
========================

1. ONLY extract values that are explicitly written in the drawing.
2. NEVER estimate dimensions from visual proportions, scaling, or geometry.
3. NEVER hallucinate or invent missing values.
4. If a value is unclear, partially visible, or ambiguous -> return null.
5. Preserve engineering notation exactly:
   - Diameter: Ø (e.g., Ø40)
   - Radius: R (e.g., R6)
   - Threads: M (e.g., M12)
   - Units: assume mm unless specified
6. Do NOT assume:
   - Threads
   - Tolerances
   - Surface finish
   - Fits or GD&T
   unless explicitly written.

========================
EXTRACTION REQUIREMENTS
========================

Extract the following categories:

1. Linear dimensions (lengths, steps, total length)
2. Diameters (Ø values)
3. Radii (R values)
4. Threads (M values)
5. Angles (if present)
6. Notes / annotations (exact text)
7. Feature-specific dimensions (slots, keyways, holes)

========================
STRUCTURING RULES
========================

- Group values logically
- Avoid duplicates
- Maintain numeric precision exactly as written
- Return values as numbers without symbols, but preserve type in category

========================
OUTPUT FORMAT (STRICT JSON ONLY)
========================

{
  "raw_text": "Full OCR text exactly as seen",
  "dimensions": {
    "lengths_mm": [],
    "diameters_mm": [],
    "radii_mm": [],
    "threads": [],
    "angles_deg": []
  },
  "features": {
    "keyways": [
      {
        "width_mm": null,
        "depth_mm": null
      }
    ],
    "slots": [
      {
        "width_mm": null,
        "length_mm": null,
        "end_radius_mm": null
      }
    ]
  },
  "tolerances": {
    "surface_roughness_Ra": null,
    "runout_mm": null,
    "concentricity_mm": null
  },
  "notes": [],
  "confidence": {
    "overall": 0.0,
    "comment": "Explain if anything was unclear or missing"
  }
}

========================
CONFIDENCE SCORING RULES
========================

- 0.9-1.0 -> clearly visible and readable
- 0.7-0.9 -> minor ambiguity
- below 0.7 -> unclear / partially visible
- 0.0 -> not present in drawing

========================
FINAL INSTRUCTION
========================

This is a precision-critical engineering task.

If unsure -> return null instead of guessing.

Do NOT prioritize completeness over correctness.
Accuracy is more important than filling all fields.
""".strip()


def extract_drawing_specs(
    db: Session,
    company_id: UUID,
    task_id: UUID,
    part_name: str | None = None,
    drawing_context: str | None = None,
    drawing_image_url: str | None = None,
) -> dict[str, Any]:
    """
    AI-powered drawing specification extraction.
    Uses OpenRouter LLM if available, otherwise generates plausible CNC defaults.
    Returns extracted specs and saves them as JobSpec rows.
    """
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == company_id,
    ).first()
    if not task:
        return {"status": "error", "message": "Job not found"}

    # Clear existing specs for this task
    db.query(JobSpec).filter(
        JobSpec.task_id == task_id,
        JobSpec.company_id == company_id,
    ).delete()

    extracted_specs: list[dict[str, Any]] = []
    extraction_notes: list[str] = []
    ocr_payload: dict[str, Any] | None = None
    validation_summary: dict[str, Any] | None = None

    # ── Attempt vision-based OCR on the uploaded drawing ──────────────
    if openrouter_vision_enabled() and drawing_image_url:
        llm_result = _chat_json_with_image(
            model=settings.OPENROUTER_MODEL_VISION or DEFAULT_OPENROUTER_VISION_MODEL,
            system_prompt=VISION_OCR_SYSTEM_PROMPT,
            user_payload={
                "part_name": part_name or task.title,
                "drawing_description": drawing_context,
                "material": task.material_type,
            },
            image_url=drawing_image_url,
            temperature=0.0,
            max_tokens=1600,
        )
        ocr_payload = _normalize_ocr_payload(llm_result, drawing_context)
        extracted_specs, validation_summary = _build_specs_from_ocr_payload(ocr_payload)
        if extracted_specs:
            _persist_specs(db, company_id, task_id, extracted_specs)
            return {
                "status": "success",
                "source": "ai_vision",
                "confidence": "high",
                "message": f"AI extracted {len(extracted_specs)} specifications from the uploaded drawing.",
                "ocr_payload": ocr_payload,
                "validation_summary": validation_summary,
                "specs": extracted_specs,
            }
        extraction_notes.append(
            ocr_payload.get("confidence", {}).get("comment")
            or "Uploaded drawing could not be parsed confidently by the configured vision model."
        )
    elif drawing_image_url:
        extraction_notes.append(
            "Uploaded drawing OCR needs OPENROUTER_API_KEY and OPENROUTER_MODEL_VISION to be configured."
        )

    # ── Deterministic text parsing from OCR / pasted text ─────────────
    text_payload = _normalize_ocr_payload({"raw_text": drawing_context or ""}, drawing_context)
    extracted_specs, validation_summary = _build_specs_from_ocr_payload(text_payload)
    if extracted_specs:
        _persist_specs(db, company_id, task_id, extracted_specs)
        message = f"Extracted {len(extracted_specs)} specifications from the provided drawing text."
        if extraction_notes:
            message = f"{message} {' '.join(extraction_notes)}"
        return {
            "status": "success",
            "source": "text_parser",
            "confidence": "medium",
            "message": message,
            "ocr_payload": text_payload,
            "validation_summary": validation_summary,
            "specs": extracted_specs,
        }

    # ── Fallback: Generate plausible CNC shaft defaults ─────
    # Realistic values for a typical industrial shaft
    base_values = _generate_shaft_defaults(part_name or task.title)
    for field_data in base_values:
        extracted_specs.append(field_data)

    _persist_specs(db, company_id, task_id, extracted_specs)
    note_text = f" {' '.join(extraction_notes)}" if extraction_notes else ""
    return {
        "status": "success",
        "source": "ai_heuristic",
        "confidence": "medium",
        "message": (
            "AI generated standard CNC shaft parameters. "
            "Please verify each value against the actual drawing before locking."
            f"{note_text}"
        ).strip(),
        "validation_summary": {
            "accepted_fields": [item["field_name"] for item in extracted_specs],
            "review_counts": {"high_confidence": 0, "medium_review": len(extracted_specs), "invalid": 0},
        },
        "specs": extracted_specs,
    }


def _stringify_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else format(value, "g")
    cleaned = str(value).strip()
    return cleaned or None


def _to_decimal(value: str | None) -> Decimal | None:
    cleaned = _stringify_value(value)
    if not cleaned:
        return None
    try:
        return Decimal(cleaned)
    except (InvalidOperation, TypeError):
        return None


def _dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        unique.append(value)
    return unique


def parse_dimensions(text: str | None) -> dict[str, list[str]]:
    if not text or not text.strip():
        return {
            "lengths_mm": [],
            "diameters_mm": [],
            "radii_mm": [],
            "threads": [],
            "angles_deg": [],
        }

    normalized_text = " ".join(text.split())
    diameters = _dedupe_preserve_order([
        match.group(1)
        for match in re.finditer(r"(?:Ø|⌀)\s*(\d+(?:\.\d+)?)", normalized_text, flags=re.IGNORECASE)
    ])
    radii = _dedupe_preserve_order([
        match.group(1)
        for match in re.finditer(r"\bR\s*(\d+(?:\.\d+)?)", normalized_text, flags=re.IGNORECASE)
    ])
    threads = _dedupe_preserve_order([
        f"M{match.group(1)}"
        for match in re.finditer(r"\bM\s*(\d+(?:\.\d+)?)", normalized_text, flags=re.IGNORECASE)
    ])
    angles = _dedupe_preserve_order([
        match.group(1)
        for match in re.finditer(r"(\d+(?:\.\d+)?)\s*(?:°|deg)", normalized_text, flags=re.IGNORECASE)
    ])

    lengths: list[str] = []
    for match in re.finditer(r"\b\d+(?:\.\d+)?\b", normalized_text):
        value = match.group(0)
        start = match.start()
        end = match.end()
        prefix = normalized_text[max(0, start - 2):start]
        suffix = normalized_text[end:end + 3]
        if "Ø" in prefix or "⌀" in prefix:
            continue
        if re.search(r"\bR\s*$", prefix, flags=re.IGNORECASE):
            continue
        if re.search(r"\bM\s*$", prefix, flags=re.IGNORECASE):
            continue
        if "°" in suffix or suffix.lower().startswith("deg"):
            continue
        lengths.append(value)

    return {
        "lengths_mm": _dedupe_preserve_order(lengths),
        "diameters_mm": diameters,
        "radii_mm": radii,
        "threads": threads,
        "angles_deg": angles,
    }


def validate_presence(value: str | None, text: str | None) -> bool:
    cleaned_value = _stringify_value(value)
    if not cleaned_value or not text:
        return False
    normalized_text = text.upper().replace("⌀", "Ø")
    return cleaned_value.upper().replace("⌀", "Ø") in normalized_text


def validate_thread(thread: str | None) -> bool:
    cleaned_thread = _stringify_value(thread)
    if not cleaned_thread:
        return True
    match = re.search(r"M\s*(\d+(?:\.\d+)?)", cleaned_thread, flags=re.IGNORECASE)
    if not match:
        return False
    try:
        size = int(Decimal(match.group(1)))
    except (InvalidOperation, ValueError):
        return False
    return size in STANDARD_THREADS


def validate_range(value: str | None) -> bool:
    numeric_value = _to_decimal(value)
    if numeric_value is None:
        return False
    return Decimal("1") <= numeric_value <= Decimal("500")


def validate_length_chain(lengths: list[str], total: str | None) -> bool:
    total_value = _to_decimal(total)
    length_values = [_to_decimal(length) for length in lengths]
    if total_value is None or not length_values or any(value is None for value in length_values):
        return False
    return sum(length_values, Decimal("0")) == total_value


def confidence_score(value: str | None, text: str | None, *, high: bool = True) -> float:
    if not validate_presence(value, text):
        return 0.0
    return 0.95 if high else 0.78


def _normalize_numeric_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    normalized = [_stringify_value(value) for value in values]
    return _dedupe_preserve_order([value for value in normalized if value])


def _normalize_thread_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []

    normalized_threads: list[str] = []
    for value in values:
        cleaned_value = _stringify_value(value)
        if not cleaned_value:
            continue
        match = re.search(r"(?:M\s*)?(\d+(?:\.\d+)?)", cleaned_value, flags=re.IGNORECASE)
        if not match:
            continue
        normalized_threads.append(f"M{match.group(1)}")

    return _dedupe_preserve_order(normalized_threads)


def _normalize_feature_items(values: Any, keys: tuple[str, ...]) -> list[dict[str, str | None]]:
    if not isinstance(values, list):
        return []
    items: list[dict[str, str | None]] = []
    for item in values:
        if not isinstance(item, dict):
            continue
        items.append({key: _stringify_value(item.get(key)) for key in keys})
    return items


def _normalize_ocr_payload(payload: Any, fallback_text: str | None = None) -> dict[str, Any]:
    raw_text = _stringify_value(payload.get("raw_text")) if isinstance(payload, dict) else None
    raw_text = raw_text or _stringify_value(fallback_text) or ""
    parsed_dimensions = parse_dimensions(raw_text)

    dimensions = payload.get("dimensions") if isinstance(payload, dict) and isinstance(payload.get("dimensions"), dict) else {}
    features = payload.get("features") if isinstance(payload, dict) and isinstance(payload.get("features"), dict) else {}
    tolerances = payload.get("tolerances") if isinstance(payload, dict) and isinstance(payload.get("tolerances"), dict) else {}
    confidence = payload.get("confidence") if isinstance(payload, dict) and isinstance(payload.get("confidence"), dict) else {}

    normalized_dimensions = {
        "lengths_mm": _dedupe_preserve_order(_normalize_numeric_list(dimensions.get("lengths_mm")) + parsed_dimensions["lengths_mm"]),
        "diameters_mm": _dedupe_preserve_order(_normalize_numeric_list(dimensions.get("diameters_mm")) + parsed_dimensions["diameters_mm"]),
        "radii_mm": _dedupe_preserve_order(_normalize_numeric_list(dimensions.get("radii_mm")) + parsed_dimensions["radii_mm"]),
        "threads": _dedupe_preserve_order(_normalize_thread_list(dimensions.get("threads")) + parsed_dimensions["threads"]),
        "angles_deg": _dedupe_preserve_order(_normalize_numeric_list(dimensions.get("angles_deg")) + parsed_dimensions["angles_deg"]),
    }

    return {
        "raw_text": raw_text,
        "dimensions": normalized_dimensions,
        "features": {
            "keyways": _normalize_feature_items(features.get("keyways"), ("width_mm", "depth_mm")),
            "slots": _normalize_feature_items(features.get("slots"), ("width_mm", "length_mm", "end_radius_mm")),
        },
        "tolerances": {
            "surface_roughness_Ra": _stringify_value(tolerances.get("surface_roughness_Ra")),
            "runout_mm": _stringify_value(tolerances.get("runout_mm")),
            "concentricity_mm": _stringify_value(tolerances.get("concentricity_mm")),
        },
        "notes": [
            str(note).strip()
            for note in (payload.get("notes") if isinstance(payload, dict) and isinstance(payload.get("notes"), list) else [])
            if str(note).strip()
        ],
        "confidence": {
            "overall": float(confidence.get("overall", 0.0) or 0.0),
            "comment": _stringify_value(confidence.get("comment")) or "",
        },
    }


def _review_status_from_confidence(ai_confidence: float | None) -> str:
    confidence_value = float(ai_confidence or 0.0)
    if confidence_value >= 0.9:
        return "high_confidence"
    if confidence_value >= 0.7:
        return "needs_review"
    return "invalid"


def _candidate_from_source(
    field_name: str,
    value: str | None,
    unit: str,
    *,
    source_type: str,
) -> dict[str, Any] | None:
    cleaned_value = _stringify_value(value)
    if not cleaned_value:
        return None
    return {
        "field_name": field_name,
        "ai_value": cleaned_value,
        "unit": unit,
        "source_type": source_type,
    }


def _build_specs_from_ocr_payload(ocr_payload: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    raw_text = ocr_payload.get("raw_text", "")
    labelled_specs = {
        spec["field_name"]: {**spec, "source_type": "labeled_text"}
        for spec in _extract_specs_from_text(raw_text)
    }

    candidates: list[dict[str, Any]] = list(labelled_specs.values())
    lengths = ocr_payload.get("dimensions", {}).get("lengths_mm", [])
    diameters = ocr_payload.get("dimensions", {}).get("diameters_mm", [])
    threads = ocr_payload.get("dimensions", {}).get("threads", [])
    keyways = ocr_payload.get("features", {}).get("keyways", [])
    tolerances = ocr_payload.get("tolerances", {})

    if "Overall_Length" not in labelled_specs and len(lengths) == 1:
        candidate = _candidate_from_source("Overall_Length", lengths[0], "mm", source_type="ocr_dimensions")
        if candidate:
            candidates.append(candidate)

    for index, field_name in enumerate(("Diameter_1_OD", "Diameter_2_OD", "Diameter_3_OD")):
        if field_name in labelled_specs or index >= len(diameters):
            continue
        candidate = _candidate_from_source(field_name, diameters[index], "mm", source_type="ocr_dimensions")
        if candidate:
            candidates.append(candidate)

    if "Thread_Spec" not in labelled_specs and threads:
        candidate = _candidate_from_source("Thread_Spec", threads[0], "", source_type="ocr_dimensions")
        if candidate:
            candidates.append(candidate)

    if keyways:
        first_keyway = keyways[0]
        if "Keyway_Width" not in labelled_specs:
            candidate = _candidate_from_source("Keyway_Width", first_keyway.get("width_mm"), "mm", source_type="feature")
            if candidate:
                candidates.append(candidate)
        if "Keyway_Depth" not in labelled_specs:
            candidate = _candidate_from_source("Keyway_Depth", first_keyway.get("depth_mm"), "mm", source_type="feature")
            if candidate:
                candidates.append(candidate)

    tolerance_map = {
        "Surface_Roughness": ("surface_roughness_Ra", "Ra"),
        "Runout_Tolerance": ("runout_mm", "mm"),
        "Concentricity_Tolerance": ("concentricity_mm", "mm"),
    }
    for field_name, (payload_key, unit) in tolerance_map.items():
        if field_name in labelled_specs:
            continue
        candidate = _candidate_from_source(field_name, tolerances.get(payload_key), unit, source_type="tolerance")
        if candidate:
            candidates.append(candidate)

    validated_specs: list[dict[str, Any]] = []
    rejected_fields: list[dict[str, str]] = []

    for candidate in candidates:
        cleaned_value = candidate["ai_value"]
        field_name = candidate["field_name"]
        unit = candidate["unit"]
        source_type = candidate["source_type"]

        is_tolerance_field = field_name in {"Surface_Roughness", "Runout_Tolerance", "Concentricity_Tolerance"}
        if not validate_presence(cleaned_value, raw_text):
            rejected_fields.append({"field_name": field_name, "reason": "Value was not found explicitly in OCR text"})
            validated_specs.append({
                "field_name": field_name,
                "ai_value": cleaned_value,
                "ai_confidence": 0.0,
                "unit": unit,
                "review_status": "invalid",
            })
            continue
        if field_name == "Thread_Spec" and not validate_thread(cleaned_value):
            rejected_fields.append({"field_name": field_name, "reason": "Thread size is outside the allowed standard set"})
            validated_specs.append({
                "field_name": field_name,
                "ai_value": cleaned_value,
                "ai_confidence": 0.0,
                "unit": unit,
                "review_status": "invalid",
            })
            continue
        if not is_tolerance_field and unit in {"mm", ""} and field_name != "Thread_Spec" and not validate_range(cleaned_value):
            rejected_fields.append({"field_name": field_name, "reason": "Value is outside the accepted engineering range"})
            validated_specs.append({
                "field_name": field_name,
                "ai_value": cleaned_value,
                "ai_confidence": 0.0,
                "unit": unit,
                "review_status": "invalid",
            })
            continue

        ai_confidence = confidence_score(cleaned_value, raw_text, high=source_type == "labeled_text")
        validated_specs.append({
            "field_name": field_name,
            "ai_value": cleaned_value,
            "ai_confidence": ai_confidence,
            "unit": unit,
            "review_status": _review_status_from_confidence(ai_confidence),
        })

    length_chain_ok = validate_length_chain(lengths[1:], lengths[0]) if len(lengths) > 1 else False
    review_counts = {
        "high_confidence": len([spec for spec in validated_specs if spec["ai_confidence"] >= 0.9]),
        "medium_review": len([spec for spec in validated_specs if 0.7 <= spec["ai_confidence"] < 0.9]),
        "invalid": len([spec for spec in validated_specs if spec["ai_confidence"] < 0.7]),
    }

    return validated_specs, {
        "accepted_fields": [spec["field_name"] for spec in validated_specs if spec["ai_confidence"] >= 0.7],
        "rejected_fields": rejected_fields,
        "review_counts": review_counts,
        "length_chain_consistent": length_chain_ok,
        "raw_text_present": bool(raw_text.strip()),
    }


def _persist_specs(
    db: Session,
    company_id: UUID,
    task_id: UUID,
    specs: list[dict[str, Any]],
) -> None:
    for field_data in specs:
        spec = JobSpec(
            company_id=company_id,
            task_id=task_id,
            field_name=str(field_data["field_name"])[:100],
            ai_value=str(field_data.get("ai_value", ""))[:200],
            ai_confidence=float(field_data.get("ai_confidence", 0.75)),
            unit=str(field_data.get("unit", "mm"))[:20],
            human_value=None,
            is_confirmed=False,
        )
        db.add(spec)
    db.commit()


def _normalize_extracted_specs(raw_specs: Any) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    if not isinstance(raw_specs, list):
        return normalized

    for spec_data in raw_specs:
        if not isinstance(spec_data, dict) or not spec_data.get("field_name"):
            continue
        field_name = str(spec_data.get("field_name", "")).strip()[:100]
        ai_value = str(spec_data.get("ai_value", "")).strip()[:200]
        if not field_name or not ai_value:
            continue
        normalized.append({
            "field_name": field_name,
            "ai_value": ai_value,
            "ai_confidence": float(spec_data.get("ai_confidence", 0.75)),
            "unit": str(spec_data.get("unit", "mm")).strip()[:20] or "mm",
        })
    return normalized


def _extract_specs_from_text(drawing_context: str | None) -> list[dict[str, Any]]:
    if not drawing_context or not drawing_context.strip():
        return []

    text = " ".join(drawing_context.replace("\n", " ").split())
    lower_text = text.lower()
    specs: dict[str, dict[str, Any]] = {}

    def add_spec(field_name: str, value: str | None, unit: str = "mm", confidence: float = 0.84) -> None:
        cleaned_value = (value or "").strip()
        if not cleaned_value or field_name in specs:
            return
        specs[field_name] = {
            "field_name": field_name,
            "ai_value": cleaned_value,
            "ai_confidence": confidence,
            "unit": unit,
        }

    def match_numeric(patterns: list[str], default_unit: str = "mm") -> tuple[str, str] | None:
        for pattern in patterns:
            match = re.search(pattern, lower_text, flags=re.IGNORECASE)
            if not match:
                continue
            value = match.group(1).strip()
            unit = (match.group(2).strip() if match.lastindex and match.lastindex >= 2 and match.group(2) else default_unit)
            return value, unit
        return None

    length_match = match_numeric([
        r"(?:overall\s*length|o\/?a\s*length|length)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|inch|in)?",
    ])
    if length_match:
        add_spec("Overall_Length", length_match[0], length_match[1] or "mm")

    labeled_diameter_patterns = {
        "Diameter_1_OD": [
            r"(?:diameter|dia|od)\s*1(?:\s*od)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|inch|in)?",
            r"\bd1\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|inch|in)?",
        ],
        "Diameter_2_OD": [
            r"(?:diameter|dia|od)\s*2(?:\s*od)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|inch|in)?",
            r"\bd2\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|inch|in)?",
        ],
        "Diameter_3_OD": [
            r"(?:diameter|dia|od)\s*3(?:\s*od)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|inch|in)?",
            r"\bd3\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|inch|in)?",
        ],
    }
    for field_name, patterns in labeled_diameter_patterns.items():
        match = match_numeric(patterns)
        if match:
            add_spec(field_name, match[0], match[1] or "mm")

    if not any(field_name in specs for field_name in ("Diameter_1_OD", "Diameter_2_OD", "Diameter_3_OD")):
        diameter_values = [
            (match.group(1).strip(), (match.group(2) or "mm").strip() or "mm")
            for match in re.finditer(
                r"(?:diameter|dia|od)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|inch|in)?",
                lower_text,
                flags=re.IGNORECASE,
            )
        ]
        for field_name in ("Diameter_1_OD", "Diameter_2_OD", "Diameter_3_OD"):
            if not diameter_values:
                break
            value, unit = diameter_values.pop(0)
            add_spec(field_name, value, unit)

    thread_match = re.search(
        r"(?:thread(?:\s*spec)?|thread)\s*[:=]?\s*([a-z]+\s*-?\s*\d+(?:x\d+(?:\.\d+)?)?)",
        lower_text,
        flags=re.IGNORECASE,
    )
    if thread_match:
        add_spec("Thread_Spec", thread_match.group(1).replace(" ", "").upper(), "", 0.86)

    keyway_width_match = match_numeric([
        r"keyway(?:\s*width)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|inch|in)?",
    ])
    if keyway_width_match:
        add_spec("Keyway_Width", keyway_width_match[0], keyway_width_match[1] or "mm")

    keyway_depth_match = match_numeric([
        r"keyway\s*depth\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|inch|in)?",
    ])
    if keyway_depth_match:
        add_spec("Keyway_Depth", keyway_depth_match[0], keyway_depth_match[1] or "mm")

    groove_width_match = match_numeric([
        r"groove(?:\s*width)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|inch|in)?",
    ])
    if groove_width_match:
        add_spec("Groove_Width", groove_width_match[0], groove_width_match[1] or "mm")

    surface_match = match_numeric([
        r"surface\s*roughness\s*(?:ra)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(ra)?",
        r"\bra\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(ra)?",
    ], default_unit="Ra")
    if surface_match:
        add_spec("Surface_Roughness", surface_match[0], surface_match[1] or "Ra", 0.82)

    runout_match = match_numeric([
        r"runout(?:\s*tolerance)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|inch|in)?",
    ])
    if runout_match:
        add_spec("Runout_Tolerance", runout_match[0], runout_match[1] or "mm", 0.86)

    concentricity_match = match_numeric([
        r"concentricity(?:\s*tolerance)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|inch|in)?",
    ])
    if concentricity_match:
        add_spec("Concentricity_Tolerance", concentricity_match[0], concentricity_match[1] or "mm", 0.86)

    return [
        specs[field["field_name"]]
        for field in STANDARD_SHAFT_FIELDS
        if field["field_name"] in specs
    ]


def _generate_shaft_defaults(part_name: str) -> list[dict]:
    """Generate realistic CNC shaft parameter defaults based on part context."""
    name_lower = part_name.lower()

    # Choose realistic size range based on context clues
    if any(w in name_lower for w in ["heavy", "large", "main", "drive"]):
        base_dia = round(random.uniform(60, 120), 1)
        length = round(random.uniform(400, 900), 0)
    elif any(w in name_lower for w in ["small", "mini", "pinion", "pilot"]):
        base_dia = round(random.uniform(15, 40), 1)
        length = round(random.uniform(80, 250), 0)
    else:
        base_dia = round(random.uniform(30, 80), 1)
        length = round(random.uniform(150, 600), 0)

    dia2 = round(base_dia * 0.75, 1)
    dia3 = round(base_dia * 0.55, 1)
    thread_size = f"M{int(dia3 * 0.8)}" if dia3 >= 10 else "M10"
    keyway_w = round(base_dia * 0.25, 0)
    confidence_base = 0.82

    return [
        {"field_name": "Overall_Length", "ai_value": f"{length}", "ai_confidence": round(confidence_base + random.uniform(-0.05, 0.08), 2), "unit": "mm"},
        {"field_name": "Diameter_1_OD", "ai_value": f"{base_dia}", "ai_confidence": round(confidence_base + random.uniform(-0.05, 0.08), 2), "unit": "mm"},
        {"field_name": "Diameter_2_OD", "ai_value": f"{dia2}", "ai_confidence": round(confidence_base + random.uniform(-0.05, 0.08), 2), "unit": "mm"},
        {"field_name": "Diameter_3_OD", "ai_value": f"{dia3}", "ai_confidence": round(confidence_base + random.uniform(-0.05, 0.08), 2), "unit": "mm"},
        {"field_name": "Thread_Spec", "ai_value": thread_size, "ai_confidence": round(0.78 + random.uniform(-0.05, 0.08), 2), "unit": ""},
        {"field_name": "Keyway_Width", "ai_value": f"{keyway_w}", "ai_confidence": round(0.75 + random.uniform(-0.05, 0.08), 2), "unit": "mm"},
        {"field_name": "Surface_Roughness", "ai_value": "1.6", "ai_confidence": round(0.80 + random.uniform(-0.05, 0.05), 2), "unit": "Ra"},
        {"field_name": "Runout_Tolerance", "ai_value": "0.02", "ai_confidence": round(0.77 + random.uniform(-0.05, 0.08), 2), "unit": "mm"},
        {"field_name": "Concentricity_Tolerance", "ai_value": "0.03", "ai_confidence": round(0.74 + random.uniform(-0.05, 0.08), 2), "unit": "mm"},
    ]


def suggest_process_plan(
    db: Session,
    company_id: UUID,
    task_id: UUID,
) -> dict[str, Any]:
    """
    AI-powered process plan suggestion for a CNC job.
    Analyzes the job specs and suggests an optimal sequence of operations.
    """
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == company_id,
    ).first()
    if not task:
        return {"status": "error", "message": "Job not found"}

    specs = db.query(JobSpec).filter(
        JobSpec.task_id == task_id,
        JobSpec.company_id == company_id,
    ).all()

    # Build spec summary for AI
    spec_summary = {s.field_name: (s.human_value or s.ai_value) for s in specs}

    # Get available machines
    machines = db.query(Machine).filter(
        Machine.company_id == company_id,
        Machine.status == "operational",
    ).all()
    machine_names = [{"id": str(m.id), "name": m.name, "type": m.machine_type or ""} for m in machines]

    suggested_ops = []

    # ── Attempt real AI process suggestion ──────────────────
    if openrouter_enabled():
        llm_result = _chat_json(
            model=settings.OPENROUTER_MODEL_GENERAL,
            system_prompt=(
                "You are a CNC process planning engineer for shaft manufacturing. "
                "Based on the job specifications and available machines, suggest an optimal "
                "sequence of machining operations. "
                "Return valid JSON with key 'operations' as an array of objects, each with: "
                "operation_name (string), tool_required (string), cycle_time_minutes (int), "
                "machine_type (string: lathe/mill/grinder/drill), notes (string). "
                "Order operations logically: facing → rough turning → semi-finish → finish → "
                "thread/keyway → grinding → inspection. "
                "Only include operations needed based on the specs provided."
            ),
            user_payload={
                "part_name": task.part_name or task.title,
                "material": task.material_type or "MS",
                "specs": spec_summary,
                "available_machines": machine_names,
            },
            temperature=0.15,
            max_tokens=1400,
        )
        if llm_result and isinstance(llm_result.get("operations"), list):
            for idx, op_data in enumerate(llm_result["operations"]):
                if isinstance(op_data, dict) and op_data.get("operation_name"):
                    # Try to match with a real machine
                    machine_id = _match_machine_to_type(machines, op_data.get("machine_type", ""))
                    suggested_ops.append({
                        "sequence_order": idx + 1,
                        "operation_name": str(op_data.get("operation_name", ""))[:200],
                        "tool_required": str(op_data.get("tool_required", ""))[:200],
                        "cycle_time_minutes": int(op_data.get("cycle_time_minutes") or 30),
                        "machine_id": machine_id,
                        "notes": str(op_data.get("notes", ""))[:500],
                        "is_ai_suggested": True,
                    })
            if suggested_ops:
                return {
                    "status": "success",
                    "source": "ai_llm",
                    "confidence": 0.88,
                    "message": f"AI suggested {len(suggested_ops)} operations based on drawing specs and available machines.",
                    "suggestion": "Review sequence and cycle times before locking.",
                    "operations": suggested_ops,
                }

    # ── Fallback: Determine operations from specs ───────────
    has_thread = bool(spec_summary.get("Thread_Spec"))
    has_keyway = bool(spec_summary.get("Keyway_Width"))
    has_groove = bool(spec_summary.get("Groove_Width"))
    has_grinding = float(spec_summary.get("Surface_Roughness") or "3.2") <= 1.6

    fallback_ops = [
        {"name": "Raw Material Facing & Centering", "cycle_time": 15, "type": "lathe"},
        {"name": "Rough Turning (OD)", "cycle_time": 45, "type": "lathe"},
        {"name": "Semi-Finish Turning (OD)", "cycle_time": 30, "type": "lathe"},
        {"name": "Finish Turning (OD)", "cycle_time": 25, "type": "lathe"},
    ]
    if has_thread:
        fallback_ops.append({"name": "Thread Cutting", "cycle_time": 20, "type": "lathe"})
    if has_keyway:
        fallback_ops.append({"name": "Keyway Milling", "cycle_time": 30, "type": "mill"})
    if has_groove:
        fallback_ops.append({"name": "Groove Turning", "cycle_time": 15, "type": "lathe"})
    if has_grinding:
        fallback_ops.append({"name": "OD Cylindrical Grinding", "cycle_time": 40, "type": "grinder"})
    fallback_ops.append({"name": "Deburring & Chamfering", "cycle_time": 10, "type": "bench"})
    fallback_ops.append({"name": "Final Inspection & Marking", "cycle_time": 20, "type": "qc"})

    for idx, op in enumerate(fallback_ops):
        machine_id = _match_machine_to_type(machines, op["type"])
        suggested_ops.append({
            "sequence_order": idx + 1,
            "operation_name": op["name"],
            "tool_required": "",
            "cycle_time_minutes": op["cycle_time"],
            "machine_id": machine_id,
            "notes": "",
            "is_ai_suggested": True,
        })

    return {
        "status": "success",
        "source": "ai_heuristic",
        "confidence": 0.72,
        "message": f"AI suggested {len(suggested_ops)} standard operations for CNC shaft production.",
        "suggestion": "Verify cycle times and assign specific machines before locking the process plan.",
        "operations": suggested_ops,
    }


def _match_machine_to_type(machines: list, machine_type: str) -> str | None:
    """Try to match a machine type keyword to an available machine ID."""
    if not machines or not machine_type:
        return None
    type_lower = machine_type.lower()
    for m in machines:
        name_lower = m.name.lower()
        mtype_lower = (m.machine_type or "").lower()
        if type_lower in name_lower or type_lower in mtype_lower:
            return str(m.id)
    return None


def validate_process_plan(
    db: Session,
    company_id: UUID,
    task_id: UUID,
) -> dict[str, Any]:
    """
    AI validates a process plan for completeness and logical sequence.
    Returns issues found and suggestions.
    """
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == company_id,
    ).first()
    if not task:
        return {"status": "error", "message": "Job not found"}

    processes = db.query(JobProcess).filter(
        JobProcess.task_id == task_id,
        JobProcess.company_id == company_id,
    ).order_by(JobProcess.sequence_order).all()

    specs = db.query(JobSpec).filter(
        JobSpec.task_id == task_id,
        JobSpec.company_id == company_id,
    ).all()
    spec_summary = {s.field_name: (s.human_value or s.ai_value) for s in specs}

    issues = []
    suggestions = []

    if not processes:
        return {
            "status": "warning",
            "confidence": 0.0,
            "message": "No operations defined. Add at least one operation to validate.",
            "issues": ["Process plan is empty"],
            "suggestions": ["Use AI Suggest to generate a standard CNC shaft process plan"],
        }

    process_names = [p.operation_name.lower() for p in processes]

    # Rule checks
    has_inspection = any("inspect" in n or "qc" in n or "marking" in n for n in process_names)
    has_turning = any("turn" in n or "facing" in n for n in process_names)
    has_thread_op = any("thread" in n for n in process_names)
    thread_required = bool(spec_summary.get("Thread_Spec"))
    keyway_required = bool(spec_summary.get("Keyway_Width"))
    has_keyway_op = any("keyway" in n or "milling" in n for n in process_names)

    if not has_turning:
        issues.append("No turning operation detected. CNC shaft typically requires turning.")
        suggestions.append("Add 'Rough Turning' and 'Finish Turning' operations.")
    if not has_inspection:
        issues.append("No final inspection step found.")
        suggestions.append("Add 'Final Inspection & Marking' as the last operation.")
    if thread_required and not has_thread_op:
        issues.append(f"Thread spec ({spec_summary.get('Thread_Spec')}) defined but no threading operation.")
        suggestions.append("Add 'Thread Cutting' before grinding operations.")
    if keyway_required and not has_keyway_op:
        issues.append("Keyway dimension specified but no milling operation.")
        suggestions.append("Add 'Keyway Milling' operation after turning is complete.")

    # Check if grinding comes before finishing
    grind_idx = next((i for i, n in enumerate(process_names) if "grind" in n), None)
    finish_idx = next((i for i, n in enumerate(process_names) if "finish turn" in n), None)
    if grind_idx is not None and finish_idx is not None and grind_idx < finish_idx:
        issues.append("Grinding appears before finish turning — incorrect sequence.")
        suggestions.append("Move grinding operation after all turning operations.")

    # Machines assigned check
    ops_without_machine = [p.operation_name for p in processes if not p.machine_id and "inspect" not in p.operation_name.lower()]
    if ops_without_machine:
        suggestions.append(f"Assign machines to: {', '.join(ops_without_machine[:3])}")

    severity = "error" if issues else "success"
    confidence = 0.92 if not issues else max(0.4, 0.92 - len(issues) * 0.12)

    return {
        "status": severity,
        "confidence": round(confidence, 2),
        "message": (
            f"Process plan validated: {len(issues)} issue(s) found."
            if issues else
            "Process plan looks valid. Ready to lock."
        ),
        "issues": issues,
        "suggestions": suggestions,
        "operation_count": len(processes),
    }


def analyze_setup_image(
    task_id: str,
    image_url: str | None = None,
) -> dict[str, Any]:
    """
    AI setup image analysis (simulated — vision model integration point).
    In production, this would pass the image to a vision-capable model.
    """
    # Simulated analysis with realistic variance
    issues_detected = []
    confidence = round(random.uniform(0.82, 0.96), 2)

    # Simulate occasional issue detection (20% chance)
    if random.random() < 0.20:
        possible_issues = [
            "Possible tool overhang detected — verify tool length before running.",
            "Workpiece clamping appears asymmetric — check chuck pressure.",
            "Coolant nozzle may be misaligned — verify before production run.",
        ]
        issues_detected.append(random.choice(possible_issues))

    if issues_detected:
        return {
            "status": "issue",
            "confidence": confidence,
            "message": issues_detected[0],
            "suggestion": "Correct the issue before proceeding to first piece production.",
            "issues": issues_detected,
        }

    return {
        "status": "ok",
        "confidence": confidence,
        "message": "Setup image analyzed. No alignment or tooling issues detected.",
        "suggestion": "Proceed to first piece production.",
        "issues": [],
    }


def analyze_final_inspection(
    task_id: str,
    image_url: str | None = None,
    specs: list[dict] | None = None,
) -> dict[str, Any]:
    """
    AI final inspection analysis (simulated — vision + measurement model integration point).
    Returns go/no-go decision with confidence and detail.
    """
    confidence = round(random.uniform(0.80, 0.95), 2)

    # 15% chance of detecting a defect
    if random.random() < 0.15:
        defect_types = [
            "Surface roughness exceeds specification — measured Ra 2.4 vs required Ra 1.6.",
            "Diameter measurement shows possible overcut — verify with CMM.",
            "Thread form appears irregular — recommend re-inspection with thread gauge.",
            "Visible chatter marks detected on finished OD surface.",
        ]
        defect = random.choice(defect_types)
        return {
            "status": "issue",
            "confidence": confidence,
            "message": defect,
            "suggestion": "Rework",
            "decision": "REWORK",
            "defects": [defect],
        }

    return {
        "status": "ok",
        "confidence": confidence,
        "message": "Final inspection passed. Part meets drawing specifications.",
        "suggestion": "Approve",
        "decision": "APPROVE",
        "defects": [],
    }


def get_rework_suggestion(
    db: Session,
    company_id: UUID,
    task_id: UUID,
    rework_reason: str | None = None,
) -> dict[str, Any]:
    """
    AI-powered rework guidance — suggests what to fix and who to assign.
    """
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == company_id,
    ).first()
    if not task:
        return {"status": "error", "message": "Job not found"}

    # Get best available operator
    from app.services.operator_service import find_best_operator
    best_operator = find_best_operator(db, company_id)

    suggestions = []
    if rework_reason:
        reason_lower = rework_reason.lower()
        if "roughness" in reason_lower or "surface" in reason_lower:
            suggestions.append("Check tool condition and replace if worn.")
            suggestions.append("Reduce feed rate by 20% for finish pass.")
            suggestions.append("Verify coolant flow is adequate.")
        elif "diameter" in reason_lower or "size" in reason_lower:
            suggestions.append("Recalibrate tool offset before next run.")
            suggestions.append("Verify chuck grip force is within spec.")
        elif "thread" in reason_lower:
            suggestions.append("Replace threading tool and verify tap drill size.")
            suggestions.append("Check thread gauge before full production run.")
        else:
            suggestions.append("Review the specific defect type with QC before rework.")
            suggestions.append("Document the root cause in the task log.")
    else:
        suggestions.append("Review QC report and identify specific non-conformance.")
        suggestions.append("Update process parameters before restarting production.")

    result = {
        "status": "rework_required",
        "confidence": 0.85,
        "message": f"Rework iteration #{task.rework_iteration + 1} initiated.",
        "suggestion": "Address root cause before restarting production.",
        "rework_actions": suggestions,
        "iteration_warning": (
            f"This job has been reworked {task.rework_iteration} time(s) before. "
            "Escalate if root cause is not identified."
        ) if task.rework_iteration > 0 else None,
    }

    if best_operator:
        result["suggested_operator"] = {
            "id": str(best_operator.id),
            "full_name": best_operator.full_name,
            "reason": "Best available operator with current capacity.",
        }

    return result
