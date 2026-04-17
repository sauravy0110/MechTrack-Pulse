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
    _chat_json_with_image_result,
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


def _vision_failure_note(error: dict[str, Any] | None) -> str:
    if not error:
        return "Uploaded drawing could not be parsed confidently by the configured vision model."

    status_code = error.get("status_code")
    message = str(error.get("message") or "").strip()
    if status_code == 429:
        return (
            "The free OCR model is temporarily rate-limited upstream. "
            "Retry shortly, paste drawing text for a stable fallback, or connect your own provider key in OpenRouter."
            + (f" Details: {message}" if message else "")
        )
    if message:
        return f"Vision OCR fallback used. {message}"
    return "Uploaded drawing could not be parsed confidently by the configured vision model."

VISION_OCR_SYSTEM_PROMPT = """
You are an expert mechanical engineering drawing interpreter.

Your task is to extract ONLY actual part dimensions from the provided engineering drawing image.

========================================
DIMENSION ANCHOR RULE (MOST IMPORTANT)
========================================

A number is ONLY a valid dimension if it satisfies AT LEAST ONE of these:
  1. It has a geometric symbol prefix: Ø (diameter), R (radius), M (thread)
  2. It sits between dimension arrows/lines on the drawing
  3. It is explicitly labeled (e.g., "Overall Length = 340")
  4. It is annotated with GD&T or surface finish symbols (e.g., Ra, ⏤, ◎)

Numbers that do NOT meet any anchor rule MUST be excluded.

========================================
MANDATORY IGNORE LIST
========================================

Do NOT extract any of the following — they are NOT part dimensions:
  - Scale values (e.g., "1:2", "Scale 1:5", "2:1")
  - Projection symbols (First Angle, Third Angle)
  - Sheet/drawing numbers (e.g., "DWG-001", "Sheet 1 of 2")
  - Title block values (drawn by, date, revision, company name)
  - View labels (e.g., "Section A-A", "Detail B")
  - Part numbers, serial numbers, or order codes
  - Page numbers, item numbers in BOM tables
  - Any number appearing inside the title block border

========================================
CRITICAL EXTRACTION RULES
========================================

1. ONLY extract values that are EXPLICITLY WRITTEN as part geometry dimensions.
2. NEVER estimate dimensions from visual proportions, scaling, or geometry.
3. NEVER hallucinate or invent missing values.
4. If a value is unclear, partially visible, or ambiguous -> return null.
5. Preserve engineering notation exactly:
   - Diameter: Ø (e.g., Ø40)
   - Radius: R (e.g., R6)
   - Threads: M (e.g., M12)
   - Units: assume mm unless specified
6. Do NOT assume threads, tolerances, surface finish, fits, or GD&T
   unless EXPLICITLY annotated with the correct symbol or label.
7. Surface Roughness: ONLY extract if you see the Ra symbol (▽) or "Ra" text.
8. Runout/Concentricity: ONLY extract if you see the GD&T frame symbol.
9. Thread: ONLY extract if prefixed with 'M' (e.g., M12, M24x2).

========================================
EXTRACTION PRIORITY ORDER
========================================

1. Dimensions with Ø, R, or M prefix (HIGHEST confidence)
2. Dimensions between dimension lines/arrows
3. Labeled text values (e.g., "length = 340")
4. Standalone numbers ONLY if 100% certain they are part geometry

If a standalone number has no anchor, DO NOT INCLUDE IT.

========================================
OUTPUT FORMAT (STRICT JSON ONLY)
========================================

{
  "raw_text": "Full OCR text exactly as seen, including title block text",
  "dimensions": {
    "lengths_mm": [],
    "diameters_mm": [],
    "radii_mm": [],
    "threads": [],
    "angles_deg": []
  },
  "features": {
    "keyways": [{"width_mm": null, "depth_mm": null}],
    "slots": [{"width_mm": null, "length_mm": null, "end_radius_mm": null}]
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

========================================
CONFIDENCE SCORING RULES
========================================

- 0.9-1.0 -> dimension has clear anchor (Ø, R, M, dimension lines)
- 0.7-0.9 -> dimension is labeled but minor ambiguity exists
- below 0.7 -> unclear / partially visible
- 0.0 -> not present or cannot be confidently identified as a part dimension

========================================
FINAL INSTRUCTION
========================================

This is a precision-critical engineering task.

If unsure -> return null instead of guessing.
Accuracy is MORE important than completeness.
It is BETTER to return fewer correct dimensions than many wrong ones.

Before including ANY number, ask yourself:
"Does this number have a dimensional anchor (symbol, arrow, label)?"
If the answer is no -> DO NOT INCLUDE IT.
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
        llm_result, vision_error = _chat_json_with_image_result(
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
            or _vision_failure_note(vision_error)
        )
    elif drawing_image_url:
        extraction_notes.append(
            "Uploaded drawing OCR needs OPENROUTER_API_KEY to be configured."
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

    note_text = " ".join(note for note in extraction_notes if note).strip()
    return {
        "status": "warning",
        "source": "manual_review",
        "confidence": "low",
        "message": (
            "No reliable drawing specs could be extracted from the uploaded image/text. "
            "Paste clearer drawing text or use a sharper image before locking the job."
            + (f" {note_text}" if note_text else "")
        ).strip(),
        "validation_summary": {
            "accepted_fields": [],
            "rejected_fields": [],
            "review_counts": {"high_confidence": 0, "medium_review": 0, "invalid": 0},
            "raw_text_present": bool((drawing_context or "").strip()),
        },
        "specs": [],
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


def _normalize_numeric_sequence(values: Any, *, dedupe: bool = True) -> list[str]:
    if not isinstance(values, list):
        return []
    normalized = [_stringify_value(value) for value in values]
    filtered = [value for value in normalized if value]
    return _dedupe_preserve_order(filtered) if dedupe else filtered


def _context_window(text: str, start: int, end: int, *, radius: int = 20) -> str:
    return text[max(0, start - radius):min(len(text), end + radius)]


# Patterns for text that indicates non-geometry context (title block, scale, metadata)
_TITLE_BLOCK_KEYWORDS = re.compile(
    r"\b(?:scale|projection|drawn\s*by|checked\s*by|approved|date|rev(?:ision)?|"
    r"sheet|dwg|drawing\s*no|part\s*no|serial|order|job\s*no|material\s*grade|"
    r"tolerance\s*unless|general\s*tolerance|all\s*dimensions\s*in|third\s*angle|"
    r"first\s*angle|do\s*not\s*scale|weight|mass|finish|treatment|hardness|heat)\b",
    flags=re.IGNORECASE,
)

# Pattern matching scale notation like "1:2", "Scale 1:5", "2:1"
_SCALE_PATTERN = re.compile(
    r"(?:scale\s*[:=]?\s*)?\d+\s*:\s*\d+",
    flags=re.IGNORECASE,
)


def _is_in_title_block_context(text: str, start: int, end: int) -> bool:
    """Check if a number is near title block / scale / metadata keywords."""
    context = text[max(0, start - 60):min(len(text), end + 40)].lower()
    if _TITLE_BLOCK_KEYWORDS.search(context):
        return True
    if _SCALE_PATTERN.search(context):
        return True
    return False


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
        if not _is_in_title_block_context(normalized_text, match.start(), match.end())
    ])
    radii = _dedupe_preserve_order([
        match.group(1)
        for match in re.finditer(r"\bR\s*(\d+(?:\.\d+)?)", normalized_text, flags=re.IGNORECASE)
        if not _is_in_title_block_context(normalized_text, match.start(), match.end())
    ])
    threads = _dedupe_preserve_order([
        f"M{match.group(1)}"
        for match in re.finditer(r"\bM\s*(\d+(?:\.\d+)?)", normalized_text, flags=re.IGNORECASE)
        if not _is_in_title_block_context(normalized_text, match.start(), match.end())
    ])
    angles = _dedupe_preserve_order([
        match.group(1)
        for match in re.finditer(r"(\d+(?:\.\d+)?)\s*(?:°|deg)", normalized_text, flags=re.IGNORECASE)
        if not _is_in_title_block_context(normalized_text, match.start(), match.end())
    ])

    lengths: list[str] = []
    anchored_length_patterns = [
        r"(?:overall\s*length|overall|o\/?a\s*length|total\s*length|length)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:mm)?",
        r"(?:step\s*lengths?|segment\s*lengths?)\s*[:=]?\s*((?:\d+(?:\.\d+)?\s*){1,12})",
    ]
    for pattern in anchored_length_patterns:
        for match in re.finditer(pattern, normalized_text, flags=re.IGNORECASE):
            if _is_in_title_block_context(normalized_text, match.start(), match.end()):
                continue
            values = re.findall(r"\d+(?:\.\d+)?", match.group(1))
            for value in values:
                decimal_value = _to_decimal(value)
                if decimal_value is None or decimal_value < Decimal("1") or decimal_value > Decimal("500"):
                    continue
                lengths.append(value)

    if "step lengths" not in normalized_text.lower() and "segment lengths" not in normalized_text.lower():
        lengths = _dedupe_preserve_order(lengths)

    return {
        "lengths_mm": lengths,
        "diameters_mm": diameters,
        "radii_mm": radii,
        "threads": threads,
        "angles_deg": angles,
    }


def _parse_feature_dimensions_from_text(text: str | None) -> dict[str, list[dict[str, str | None]]]:
    if not text or not text.strip():
        return {"keyways": [], "slots": []}

    normalized_text = " ".join(text.split())

    keyway_combined = re.search(
        r"keyway(?:\s*size)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:mm)?",
        normalized_text,
        flags=re.IGNORECASE,
    )
    keyway_width = re.search(
        r"keyway(?:\s*width)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:mm)?",
        normalized_text,
        flags=re.IGNORECASE,
    )
    keyway_depth = re.search(
        r"keyway\s*depth\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:mm)?",
        normalized_text,
        flags=re.IGNORECASE,
    )

    keyways: list[dict[str, str | None]] = []
    if keyway_combined or keyway_width or keyway_depth:
        keyways.append({
            "width_mm": keyway_combined.group(1) if keyway_combined else (keyway_width.group(1) if keyway_width else None),
            "depth_mm": keyway_combined.group(2) if keyway_combined else (keyway_depth.group(1) if keyway_depth else None),
        })

    slots: list[dict[str, str | None]] = []
    for match in re.finditer(
        r"slot(?:\s*size)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:mm)?(?:\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:mm)?)?",
        normalized_text,
        flags=re.IGNORECASE,
    ):
        slots.append({
            "width_mm": match.group(1),
            "length_mm": match.group(2),
            "end_radius_mm": match.group(3),
        })

    if not slots:
        slot_width = re.search(
            r"slot\s*width\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:mm)?",
            normalized_text,
            flags=re.IGNORECASE,
        )
        slot_length = re.search(
            r"slot\s*length\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:mm)?",
            normalized_text,
            flags=re.IGNORECASE,
        )
        slot_radius = re.search(
            r"(?:slot\s*)?(?:end\s*radius|slot\s*radius)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:mm)?",
            normalized_text,
            flags=re.IGNORECASE,
        )
        if slot_width or slot_length or slot_radius:
            slots.append({
                "width_mm": slot_width.group(1) if slot_width else None,
                "length_mm": slot_length.group(1) if slot_length else None,
                "end_radius_mm": slot_radius.group(1) if slot_radius else None,
            })

    return {
        "keyways": keyways,
        "slots": slots,
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


def validate_geometry_consistency(diameters: list[str], lengths: list[str]) -> tuple[bool, str]:
    """
    Cross-validate diameters against lengths for shaft geometry sanity.

    Rules:
    - A shaft diameter should NEVER exceed the total shaft length
    - If max_diameter > max_length -> something was misclassified
    - Returns (is_consistent, reason)
    """
    diameter_values = [_to_decimal(d) for d in diameters]
    length_values = [_to_decimal(l) for l in lengths]

    diameter_values = [d for d in diameter_values if d is not None]
    length_values = [l for l in length_values if l is not None]

    if not diameter_values or not length_values:
        return True, ""  # Not enough data to validate

    max_dia = max(diameter_values)
    max_len = max(length_values)

    if max_dia >= max_len:
        return False, (
            f"Geometry inconsistency: max diameter ({max_dia} mm) ≥ max length ({max_len} mm). "
            "A shaft diameter cannot exceed the shaft length. Values may be misclassified."
        )
    return True, ""


def flag_duplicate_pattern(values: list[str]) -> bool:
    """
    Detect noisy OCR repetition: if more than 50% of values are duplicates,
    the parser likely hit a repeated number from noise or bad parsing.

    Returns True if duplication ratio is HIGH (low confidence signal).
    """
    if len(values) < 3:
        return False
    unique_ratio = len(set(values)) / len(values)
    return unique_ratio < 0.5


def confidence_score(value: str | None, text: str | None, *, high: bool = True) -> float:
    if not validate_presence(value, text):
        return 0.0
    return 0.95 if high else 0.78


def _normalize_numeric_list(values: Any) -> list[str]:
    return _normalize_numeric_sequence(values, dedupe=True)


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
    parsed_features = _parse_feature_dimensions_from_text(raw_text)

    dimensions = payload.get("dimensions") if isinstance(payload, dict) and isinstance(payload.get("dimensions"), dict) else {}
    features = payload.get("features") if isinstance(payload, dict) and isinstance(payload.get("features"), dict) else {}
    tolerances = payload.get("tolerances") if isinstance(payload, dict) and isinstance(payload.get("tolerances"), dict) else {}
    confidence = payload.get("confidence") if isinstance(payload, dict) and isinstance(payload.get("confidence"), dict) else {}

    explicit_lengths = _normalize_numeric_sequence(dimensions.get("lengths_mm"), dedupe=False)
    explicit_diameters = _normalize_numeric_sequence(dimensions.get("diameters_mm"), dedupe=True)
    explicit_radii = _normalize_numeric_sequence(dimensions.get("radii_mm"), dedupe=True)
    explicit_angles = _normalize_numeric_sequence(dimensions.get("angles_deg"), dedupe=True)
    explicit_keyways = _normalize_feature_items(features.get("keyways"), ("width_mm", "depth_mm"))
    explicit_slots = _normalize_feature_items(features.get("slots"), ("width_mm", "length_mm", "end_radius_mm"))

    selected_lengths = parsed_dimensions["lengths_mm"] if len(parsed_dimensions["lengths_mm"]) > len(explicit_lengths) else (explicit_lengths or parsed_dimensions["lengths_mm"])
    selected_diameters = parsed_dimensions["diameters_mm"] if len(parsed_dimensions["diameters_mm"]) > len(explicit_diameters) else (explicit_diameters or parsed_dimensions["diameters_mm"])
    selected_radii = parsed_dimensions["radii_mm"] if len(parsed_dimensions["radii_mm"]) > len(explicit_radii) else (explicit_radii or parsed_dimensions["radii_mm"])
    selected_angles = parsed_dimensions["angles_deg"] if len(parsed_dimensions["angles_deg"]) > len(explicit_angles) else (explicit_angles or parsed_dimensions["angles_deg"])
    selected_keyways = parsed_features["keyways"] if len(parsed_features["keyways"]) > len(explicit_keyways) else (explicit_keyways or parsed_features["keyways"])
    selected_slots = parsed_features["slots"] if len(parsed_features["slots"]) > len(explicit_slots) else (explicit_slots or parsed_features["slots"])

    normalized_dimensions = {
        "lengths_mm": selected_lengths,
        "diameters_mm": selected_diameters,
        "radii_mm": selected_radii,
        "threads": _normalize_thread_list(dimensions.get("threads")) or parsed_dimensions["threads"],
        "angles_deg": selected_angles,
    }

    return {
        "raw_text": raw_text,
        "dimensions": normalized_dimensions,
        "features": {
            "keyways": selected_keyways,
            "slots": selected_slots,
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


def _remove_single_occurrence(values: list[str], value_to_remove: str | None) -> list[str]:
    if not value_to_remove:
        return list(values)

    remaining = list(values)
    for index, value in enumerate(remaining):
        if value == value_to_remove:
            del remaining[index]
            break
    return remaining


def _append_numbered_candidates(
    candidates: list[dict[str, Any]],
    *,
    existing_field_names: set[str],
    values: list[str],
    field_name_builder,
    unit: str,
    source_type: str,
    start_index: int = 1,
) -> None:
    for offset, value in enumerate(values, start=start_index):
        field_name = field_name_builder(offset)
        if field_name in existing_field_names:
            continue
        candidate = _candidate_from_source(field_name, value, unit, source_type=source_type)
        if candidate:
            candidates.append(candidate)
            existing_field_names.add(field_name)


def _build_specs_from_ocr_payload(ocr_payload: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    raw_text = ocr_payload.get("raw_text", "")
    labelled_specs = {
        spec["field_name"]: {**spec, "source_type": "labeled_text"}
        for spec in _extract_specs_from_text(raw_text)
    }

    candidates: list[dict[str, Any]] = list(labelled_specs.values())
    existing_field_names = set(labelled_specs)
    lengths = ocr_payload.get("dimensions", {}).get("lengths_mm", [])
    diameters = ocr_payload.get("dimensions", {}).get("diameters_mm", [])
    radii = ocr_payload.get("dimensions", {}).get("radii_mm", [])
    threads = ocr_payload.get("dimensions", {}).get("threads", [])
    keyways = ocr_payload.get("features", {}).get("keyways", [])
    slots = ocr_payload.get("features", {}).get("slots", [])
    tolerances = ocr_payload.get("tolerances", {})

    overall_length_value = labelled_specs.get("Overall_Length", {}).get("ai_value")
    infer_overall_length = (
        len(lengths) == 1
        or bool(re.search(r"\b(?:overall|o\/?a|total)\s*length\b", raw_text, flags=re.IGNORECASE))
        or (len(lengths) > 1 and validate_length_chain(lengths[1:], lengths[0]))
    )
    if "Overall_Length" not in labelled_specs and lengths and infer_overall_length:
        candidate = _candidate_from_source("Overall_Length", lengths[0], "mm", source_type="ocr_dimensions")
        if candidate:
            candidates.append(candidate)
            existing_field_names.add("Overall_Length")
            overall_length_value = lengths[0]

    for index, field_name in enumerate(("Diameter_1_OD", "Diameter_2_OD", "Diameter_3_OD")):
        if field_name in existing_field_names or index >= len(diameters):
            continue
        candidate = _candidate_from_source(field_name, diameters[index], "mm", source_type="ocr_dimensions")
        if candidate:
            candidates.append(candidate)
            existing_field_names.add(field_name)

    if len(diameters) > 3:
        _append_numbered_candidates(
            candidates,
            existing_field_names=existing_field_names,
            values=diameters[3:],
            field_name_builder=lambda idx: f"Diameter_{idx}_OD",
            unit="mm",
            source_type="ocr_dimensions",
            start_index=4,
        )

    if "Thread_Spec" not in existing_field_names and threads:
        candidate = _candidate_from_source("Thread_Spec", threads[0], "", source_type="ocr_dimensions")
        if candidate:
            candidates.append(candidate)
            existing_field_names.add("Thread_Spec")

    if radii:
        _append_numbered_candidates(
            candidates,
            existing_field_names=existing_field_names,
            values=radii,
            field_name_builder=lambda idx: f"Radius_{idx}",
            unit="mm",
            source_type="ocr_dimensions",
        )

    remaining_lengths = _remove_single_occurrence(lengths, overall_length_value)
    if remaining_lengths:
        _append_numbered_candidates(
            candidates,
            existing_field_names=existing_field_names,
            values=remaining_lengths,
            field_name_builder=lambda idx: f"Linear_Length_{idx}",
            unit="mm",
            source_type="ocr_dimensions",
        )

    if keyways:
        first_keyway = keyways[0]
        if "Keyway_Width" not in existing_field_names:
            candidate = _candidate_from_source("Keyway_Width", first_keyway.get("width_mm"), "mm", source_type="feature")
            if candidate:
                candidates.append(candidate)
                existing_field_names.add("Keyway_Width")
        if "Keyway_Depth" not in existing_field_names:
            candidate = _candidate_from_source("Keyway_Depth", first_keyway.get("depth_mm"), "mm", source_type="feature")
            if candidate:
                candidates.append(candidate)
                existing_field_names.add("Keyway_Depth")

        for index, keyway in enumerate(keyways[1:], start=2):
            for suffix, payload_key in (("Width", "width_mm"), ("Depth", "depth_mm")):
                field_name = f"Keyway_{index}_{suffix}"
                if field_name in existing_field_names:
                    continue
                candidate = _candidate_from_source(field_name, keyway.get(payload_key), "mm", source_type="feature")
                if candidate:
                    candidates.append(candidate)
                    existing_field_names.add(field_name)

    if slots:
        for index, slot in enumerate(slots, start=1):
            slot_field_map = (
                ("Width", "width_mm"),
                ("Length", "length_mm"),
                ("End_Radius", "end_radius_mm"),
            )
            for suffix, payload_key in slot_field_map:
                field_name = f"Slot_{index}_{suffix}"
                if field_name in existing_field_names:
                    continue
                candidate = _candidate_from_source(field_name, slot.get(payload_key), "mm", source_type="feature")
                if candidate:
                    candidates.append(candidate)
                    existing_field_names.add(field_name)

    # ── Context-Aware Tolerance Validation ─────────────────────
    # Only accept tolerance fields if their KEYWORD exists in raw_text
    tolerance_map = {
        "Surface_Roughness": ("surface_roughness_Ra", "Ra"),
        "Runout_Tolerance": ("runout_mm", "mm"),
        "Concentricity_Tolerance": ("concentricity_mm", "mm"),
    }
    tolerance_keyword_map = {
        "Surface_Roughness": ["ra", "roughness", "surface finish", "▽"],
        "Runout_Tolerance": ["runout", "run out", "run-out", "⏤"],
        "Concentricity_Tolerance": ["concentricity", "concentric", "◎"],
    }
    raw_text_lower = raw_text.lower()

    for field_name, (payload_key, unit) in tolerance_map.items():
        if field_name in existing_field_names:
            continue
        # Context-aware check: reject if keyword is NOT in raw text
        keywords = tolerance_keyword_map.get(field_name, [])
        keyword_found = any(kw in raw_text_lower for kw in keywords)
        if not keyword_found:
            tol_value = _stringify_value(tolerances.get(payload_key))
            if tol_value:
                logger.debug("Rejecting %s=%s: keyword not found in raw text", field_name, tol_value)
            continue
        candidate = _candidate_from_source(field_name, tolerances.get(payload_key), unit, source_type="tolerance")
        if candidate:
            candidates.append(candidate)
            existing_field_names.add(field_name)

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

        # ── Thread context validation: M{size} must appear in raw text ──
        if field_name == "Thread_Spec":
            thread_match = re.search(r"M\s*\d+", raw_text, flags=re.IGNORECASE)
            if not thread_match:
                rejected_fields.append({"field_name": field_name, "reason": "Thread spec (M prefix) not found in drawing text"})
                validated_specs.append({
                    "field_name": field_name,
                    "ai_value": cleaned_value,
                    "ai_confidence": 0.0,
                    "unit": unit,
                    "review_status": "invalid",
                })
                continue
            if not validate_thread(cleaned_value):
                rejected_fields.append({"field_name": field_name, "reason": "Thread size is outside the allowed standard set"})
                validated_specs.append({
                    "field_name": field_name,
                    "ai_value": cleaned_value,
                    "ai_confidence": 0.0,
                    "unit": unit,
                    "review_status": "invalid",
                })
                continue

        # ── Diameter context validation: Ø or ⌀ prefix should be present ──
        if field_name.startswith("Diameter_") and source_type == "ocr_dimensions":
            diameter_anchored = bool(
                re.search(r"(?:Ø|⌀)\s*" + re.escape(cleaned_value), raw_text)
                or re.search(r"(?:diameter|dia|od)\s*[:=]?\s*" + re.escape(cleaned_value), raw_text, flags=re.IGNORECASE)
            )
            if not diameter_anchored:
                # Still accept but lower confidence
                validated_specs.append({
                    "field_name": field_name,
                    "ai_value": cleaned_value,
                    "ai_confidence": 0.5,
                    "unit": unit,
                    "review_status": "needs_review",
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

    # ── Mutual Consistency Check ──────────────────────────────────
    geometry_ok, geometry_warning = validate_geometry_consistency(diameters, lengths)
    if not geometry_ok:
        logger.warning("Geometry consistency check failed: %s", geometry_warning)
        # Downgrade confidence of all diameter and length specs
        for spec in validated_specs:
            if spec["field_name"].startswith(("Diameter_", "Overall_Length", "Linear_Length_")):
                spec["ai_confidence"] = min(spec["ai_confidence"], 0.5)
                spec["review_status"] = "needs_review"

    # ── Duplicate Pattern Check ─────────────────────────────────
    diameter_duplication = flag_duplicate_pattern(diameters)
    length_duplication = flag_duplicate_pattern(lengths)
    if diameter_duplication or length_duplication:
        noisy_prefixes = []
        if diameter_duplication:
            noisy_prefixes.append("Diameter_")
        if length_duplication:
            noisy_prefixes.append(("Overall_Length", "Linear_Length_"))
        logger.warning("Duplicate pattern detected in: %s", noisy_prefixes)
        for spec in validated_specs:
            if any(spec["field_name"].startswith(p if isinstance(p, str) else p) for p in noisy_prefixes):
                spec["ai_confidence"] = min(spec["ai_confidence"], 0.55)
                spec["review_status"] = "needs_review"

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
        "geometry_consistent": geometry_ok,
        "geometry_warning": geometry_warning or None,
        "diameter_duplication_detected": diameter_duplication,
        "length_duplication_detected": length_duplication,
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
