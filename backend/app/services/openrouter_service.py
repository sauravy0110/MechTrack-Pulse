"""
MechTrack Pulse — OpenRouter Service

Wraps OpenRouter's OpenAI-compatible chat completions API and exposes
high-level helpers for the AI surfaces in the MechTrack dashboards.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger("app.openrouter")
settings = get_settings()


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip().strip('"').strip("'")
    return cleaned or None


def openrouter_enabled() -> bool:
    return bool(_clean(settings.OPENROUTER_API_KEY))


def _headers() -> dict[str, str]:
    api_key = _clean(settings.OPENROUTER_API_KEY)
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY is not configured")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    site_url = _clean(settings.OPENROUTER_SITE_URL)
    app_title = _clean(settings.OPENROUTER_APP_TITLE)
    if site_url:
        headers["HTTP-Referer"] = site_url
    if app_title:
        headers["X-Title"] = app_title
    return headers


def _extract_text_content(message_content: Any) -> str:
    if isinstance(message_content, str):
        return message_content
    if isinstance(message_content, list):
        parts: list[str] = []
        for item in message_content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
        return "\n".join(part for part in parts if part)
    return ""


def _extract_json(content: str) -> dict[str, Any] | None:
    text = content.strip()
    if not text:
        return None

    for candidate in (text, re.sub(r"^```json\s*|\s*```$", "", text, flags=re.DOTALL), re.sub(r"^```\s*|\s*```$", "", text, flags=re.DOTALL)):
        try:
            parsed = json.loads(candidate.strip())
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            continue

    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return None
    return None


def _send_chat_completion(
    *,
    model: str,
    messages: list[dict[str, str]],
    temperature: float = 0.2,
    max_tokens: int = 700,
    response_format: dict[str, str] | None = None,
) -> dict[str, Any] | None:
    if not openrouter_enabled():
        return None

    candidate_models = [model]
    fallback_model = _clean(settings.OPENROUTER_MODEL_REASONING)
    if fallback_model and fallback_model not in candidate_models:
        candidate_models.append(fallback_model)

    headers = _headers()
    with httpx.Client(timeout=settings.OPENROUTER_TIMEOUT_SECONDS) as client:
        for candidate_model in candidate_models:
            payload: dict[str, Any] = {
                "model": candidate_model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            if response_format:
                payload["response_format"] = response_format

            try:
                response = client.post(
                    f"{settings.OPENROUTER_BASE_URL.rstrip('/')}/chat/completions",
                    json=payload,
                    headers=headers,
                )
                response.raise_for_status()
                return response.json()
            except httpx.HTTPStatusError as exc:
                body = exc.response.text[:500]
                logger.warning(
                    "OpenRouter chat completion rejected for %s (%s): %s",
                    candidate_model,
                    exc.response.status_code,
                    body,
                )
                if exc.response.status_code in {429, 500, 502, 503, 504}:
                    continue
                break
            except Exception as exc:  # noqa: BLE001
                logger.warning("OpenRouter chat completion failed for %s: %s", candidate_model, exc)
                continue
    return None


def _chat_json(
    *,
    model: str,
    system_prompt: str,
    user_payload: dict[str, Any],
    temperature: float = 0.2,
    max_tokens: int = 700,
) -> dict[str, Any] | None:
    response = _send_chat_completion(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=True)},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
    )
    if not response:
        return None

    choice = (response.get("choices") or [{}])[0]
    content = _extract_text_content(choice.get("message", {}).get("content", ""))
    parsed = _extract_json(content)
    if not parsed:
        logger.warning("OpenRouter returned non-JSON content for model %s", model)
    return parsed


def _chat_text(
    *,
    model: str,
    system_prompt: str,
    user_payload: dict[str, Any],
    temperature: float = 0.2,
    max_tokens: int = 700,
) -> str | None:
    response = _send_chat_completion(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=True)},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
    )
    if not response:
        return None
    choice = (response.get("choices") or [{}])[0]
    content = _extract_text_content(choice.get("message", {}).get("content", ""))
    return content.strip() or None


def get_openrouter_status() -> dict[str, Any]:
    api_key = _clean(settings.OPENROUTER_API_KEY)
    status = {
        "enabled": bool(api_key),
        "configured": bool(api_key),
        "base_url": settings.OPENROUTER_BASE_URL,
        "models": {
            "general": settings.OPENROUTER_MODEL_GENERAL,
            "fast": settings.OPENROUTER_MODEL_FAST,
            "coder": settings.OPENROUTER_MODEL_CODER,
            "reasoning": settings.OPENROUTER_MODEL_REASONING,
        },
    }
    if not api_key:
        return status

    try:
        with httpx.Client(timeout=settings.OPENROUTER_TIMEOUT_SECONDS) as client:
            response = client.get(
                f"{settings.OPENROUTER_BASE_URL.rstrip('/')}/key",
                headers=_headers(),
            )
            response.raise_for_status()
            payload = response.json().get("data", {})
            status["account"] = {
                "label": payload.get("label"),
                "limit": payload.get("limit"),
                "limit_remaining": payload.get("limit_remaining"),
                "usage": payload.get("usage"),
            }
    except httpx.HTTPStatusError as exc:
        status["enabled"] = False
        status["error"] = f"OpenRouter rejected the API key ({exc.response.status_code})"
    except Exception as exc:  # noqa: BLE001
        status["enabled"] = False
        status["error"] = str(exc)

    return status


def generate_instruction_draft_with_openrouter(context: dict[str, Any]) -> dict[str, Any] | None:
    return _chat_json(
        model=settings.OPENROUTER_MODEL_CODER,
        system_prompt=(
            "You generate concise manufacturing task instructions. "
            "Return valid JSON with keys: summary, steps, quality_checks, safety_notes, instruction_text. "
            "steps, quality_checks, and safety_notes must be arrays of short strings. "
            "Keep the content practical, shift-friendly, and grounded in the provided context."
        ),
        user_payload=context,
        temperature=0.15,
        max_tokens=900,
    )


def generate_task_assistant_with_openrouter(context: dict[str, Any]) -> dict[str, Any] | None:
    return _chat_json(
        model=settings.OPENROUTER_MODEL_FAST,
        system_prompt=(
            "You are an operator-facing manufacturing assistant. "
            "Return valid JSON with keys: workflow, steps, due_message, evidence_feedback, voice_input_hint. "
            "Keep it simple, actionable, and short."
        ),
        user_payload=context,
        temperature=0.2,
        max_tokens=800,
    )


def generate_supervisor_intelligence_with_openrouter(context: dict[str, Any]) -> dict[str, Any] | None:
    return _chat_json(
        model=settings.OPENROUTER_MODEL_GENERAL,
        system_prompt=(
            "You are a supervisor copilot for a factory control room. "
            "Return valid JSON with keys: alerts, assignment_message, bottleneck_summary, instruction_draft_summary. "
            "alerts must be an array of short strings."
        ),
        user_payload=context,
        temperature=0.2,
        max_tokens=800,
    )


def generate_owner_intelligence_with_openrouter(context: dict[str, Any]) -> dict[str, Any] | None:
    return _chat_json(
        model=settings.OPENROUTER_MODEL_GENERAL,
        system_prompt=(
            "You are an owner-facing manufacturing business strategist. "
            "Return valid JSON with keys: forecast_summary, optimization_summary, report_summary, anomalies, recommendations. "
            "anomalies and recommendations must be arrays of short strings."
        ),
        user_payload=context,
        temperature=0.2,
        max_tokens=900,
    )


def generate_client_summary_with_openrouter(context: dict[str, Any]) -> dict[str, Any] | None:
    return _chat_json(
        model=settings.OPENROUTER_MODEL_FAST,
        system_prompt=(
            "You are a client-facing operations assistant. "
            "Return valid JSON with keys: summary, delay_explanation, delivery_prediction_note. "
            "Be reassuring, transparent, and concise."
        ),
        user_payload=context,
        temperature=0.2,
        max_tokens=500,
    )


def answer_global_question_with_openrouter(context: dict[str, Any]) -> dict[str, Any] | None:
    payload = _chat_json(
        model=settings.OPENROUTER_MODEL_GENERAL,
        system_prompt=(
            "You answer operations questions for a manufacturing business. "
            "Return valid JSON with keys: answer, highlights, suggested_questions. "
            "highlights and suggested_questions must be arrays of short strings. "
            "Use only the supplied context and avoid inventing facts."
        ),
        user_payload=context,
        temperature=0.2,
        max_tokens=900,
    )
    if payload:
        return payload

    text = _chat_text(
        model=settings.OPENROUTER_MODEL_GENERAL,
        system_prompt=(
            "You answer operations questions for a manufacturing business. "
            "Respond in plain text using only the supplied context. "
            "Keep it concise, direct, and operationally useful."
        ),
        user_payload=context,
        temperature=0.2,
        max_tokens=500,
    )
    if not text:
        return None

    return {
        "answer": text,
        "highlights": [],
        "suggested_questions": [
            "Which operator is most efficient?",
            "Why are tasks delayed?",
            "Which machine is the current bottleneck?",
        ],
    }
