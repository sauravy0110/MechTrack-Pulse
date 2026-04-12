"""
MechTrack Pulse — Email Delivery Service

Robust email delivery with automatic fallback chain:
  1. Brevo HTTP API   (best free option for sending to any inbox)
  2. Resend HTTP API  (works on Render free tier — no SMTP port needed)
  3. SMTP             (works on paid hosting / local dev with Gmail App Password)
  4. Console mock     (always works — prints email to server logs for dev)

The service tries each method in order and falls through to the next
on failure, so emails are never silently lost.
"""

from email.message import EmailMessage
import smtplib
import ssl
import logging

import requests

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger("app.email")


# ═══════════════════════════════════════════════════════════════
#  Transport Layer
# ═══════════════════════════════════════════════════════════════

def _clean_env_value(value: str | None) -> str | None:
    """Normalize env values copied from dashboards with whitespace/quotes."""
    if value is None:
        return None
    cleaned = value.strip().strip("\"'")
    return cleaned or None


def _resolve_sender_name(*candidates: str | None) -> str:
    for candidate in candidates:
        cleaned = _clean_env_value(candidate)
        if cleaned:
            return cleaned
    return "MechTrack Pulse"


def _extract_response_detail(resp: requests.Response) -> str:
    try:
        payload = resp.json()
    except ValueError:
        payload = None

    if isinstance(payload, dict):
        for key in ("message", "error", "detail", "code"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

    return (resp.text or "").strip()[:300]


def _try_resend(to: str, subject: str, body: str) -> tuple[bool, str]:
    """Send via Resend HTTP API (port 443 — bypasses Render firewall)."""
    resend_api_key = _clean_env_value(settings.RESEND_API_KEY)
    if not resend_api_key:
        return False, "RESEND_API_KEY not configured"

    # Free-tier Resend accounts MUST use onboarding@resend.dev as sender.
    # Only use SMTP_FROM_EMAIL if it's a verified custom domain (not gmail/yahoo/etc).
    from_email = _clean_env_value(settings.SMTP_FROM_EMAIL) or "onboarding@resend.dev"
    free_domains = ("gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com")
    if any(from_email.endswith(f"@{d}") for d in free_domains) or from_email == "noreply@mechtrackpulse.com":
        from_email = "onboarding@resend.dev"
    from_name = _resolve_sender_name(settings.SMTP_FROM_NAME)

    payload = {
        "from": f"{from_name} <{from_email}>",
        "to": [to],
        "subject": subject,
        "text": body,
    }
    headers = {
        "Authorization": f"Bearer {resend_api_key}",
        "Content-Type": "application/json",
    }

    try:
        resp = requests.post(
            "https://api.resend.com/emails",
            json=payload,
            headers=headers,
            timeout=15,
        )
        if resp.status_code in (200, 201):
            logger.info("✅ Email sent via Resend API → %s", to)
            return True, ""
        else:
            detail = _extract_response_detail(resp)
            logger.warning("Resend API rejected (%s): %s", resp.status_code, detail)
            return False, f"Resend {resp.status_code}: {detail}"
    except requests.RequestException as exc:
        logger.warning("Resend API network error: %s", exc)
        return False, str(exc)


def _try_brevo(to: str, subject: str, body: str) -> tuple[bool, str]:
    """Send via Brevo HTTP API (allows sending to ANY email for free without custom domain)."""
    brevo_api_key = _clean_env_value(settings.BREVO_API_KEY)
    if not brevo_api_key:
        return False, "BREVO_API_KEY not configured"

    from_email = _clean_env_value(settings.BREVO_SENDER_EMAIL) or _clean_env_value(settings.SMTP_FROM_EMAIL)
    if not from_email:
        return False, "BREVO_SENDER_EMAIL or SMTP_FROM_EMAIL must be configured"
    from_name = _resolve_sender_name(settings.BREVO_SENDER_NAME, settings.SMTP_FROM_NAME)

    payload = {
        "sender": {
            "name": from_name,
            "email": from_email,
        },
        "to": [
            {"email": to},
        ],
        "subject": subject,
        "textContent": body,
    }

    headers = {
        "accept": "application/json",
        "api-key": brevo_api_key,
        "content-type": "application/json",
    }

    try:
        resp = requests.post(
            "https://api.brevo.com/v3/smtp/email",
            json=payload,
            headers=headers,
            timeout=15,
        )
        if resp.status_code in (200, 201, 202):
            logger.info("✅ Email sent via Brevo API → %s", to)
            return True, ""
        else:
            detail = _extract_response_detail(resp)
            logger.warning("Brevo API rejected (%s): %s", resp.status_code, detail)
            return False, f"Brevo {resp.status_code}: {detail}"
    except requests.RequestException as exc:
        logger.warning("Brevo API network error: %s", exc)
        return False, str(exc)


def _try_smtp(message: EmailMessage) -> tuple[bool, str]:
    """Send via traditional SMTP (requires open port 587/465)."""
    host = settings.SMTP_HOST
    username = settings.SMTP_USERNAME
    password = settings.SMTP_PASSWORD

    if not host or not username or not password:
        return False, "SMTP credentials incomplete (need HOST + USERNAME + PASSWORD)"

    try:
        if settings.SMTP_USE_SSL:
            ctx = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, settings.SMTP_PORT, timeout=15, context=ctx) as srv:
                srv.login(username, password)
                srv.send_message(message)
        else:
            with smtplib.SMTP(host, settings.SMTP_PORT, timeout=15) as srv:
                srv.ehlo()
                if settings.SMTP_USE_TLS:
                    srv.starttls(context=ssl.create_default_context())
                    srv.ehlo()
                srv.login(username, password)
                srv.send_message(message)

        logger.info("✅ Email sent via SMTP → %s", message["To"])
        return True, ""
    except Exception as exc:
        logger.warning("SMTP transport failed: %s", exc)
        return False, str(exc)


def _console_fallback(to: str, subject: str, body: str) -> str:
    """Last resort: print the email to server logs so credentials are never lost."""
    print("\n" + "=" * 60)
    print("📧  CONSOLE EMAIL FALLBACK  (no transport succeeded)")
    print(f"    To:      {to}")
    print(f"    Subject: {subject}")
    print("-" * 60)
    print(body)
    print("=" * 60 + "\n")
    logger.info("Email printed to console (fallback) → %s", to)
    return "Console fallback only (message printed to server logs)"


# ═══════════════════════════════════════════════════════════════
#  Dispatch Orchestrator
# ═══════════════════════════════════════════════════════════════

def _dispatch(message: EmailMessage) -> tuple[bool, str]:
    """
    Try every available transport in priority order.
    Returns (True, "") on a real transport success.
    Returns (False, "...") when only the console fallback worked.
    """
    to = message["To"]
    subject = message["Subject"]
    body = message.get_content()
    errors: list[str] = []

    # 1️⃣  Brevo HTTP API  (Best free option — can email anyone)
    ok, err = _try_brevo(to, subject, body)
    if ok:
        return True, ""
    if err:
        errors.append(err)

    # 2️⃣  Resend HTTP API  (Requires domain verification to email anyone)
    ok, err = _try_resend(to, subject, body)
    if ok:
        return True, ""
    if err:
        errors.append(err)

    # 3️⃣  SMTP  (Requires paid Render tier / unblocked port)
    ok, err = _try_smtp(message)
    if ok:
        return True, ""
    if err:
        errors.append(err)

    # 4️⃣  Console  (never fails)
    errors.append(_console_fallback(to, subject, body))
    combined_error = " | ".join(errors)
    logger.warning("Email delivery failed for %s: %s", to, combined_error)
    return False, combined_error


# ═══════════════════════════════════════════════════════════════
#  Public API
# ═══════════════════════════════════════════════════════════════

def _from_header() -> str:
    name = _resolve_sender_name(settings.SMTP_FROM_NAME, settings.BREVO_SENDER_NAME)
    email = (
        _clean_env_value(settings.SMTP_FROM_EMAIL)
        or _clean_env_value(settings.BREVO_SENDER_EMAIL)
        or "onboarding@resend.dev"
    )
    return f"{name} <{email}>"


def send_owner_welcome_email(
    *,
    owner_name: str,
    owner_email: str,
    company_name: str,
    temp_password: str,
) -> tuple[bool, str]:
    """Send owner onboarding email with the generated temp password."""
    msg = EmailMessage()
    msg["Subject"] = f"{company_name} has been approved on MechTrack Pulse"
    msg["From"] = _from_header()
    msg["To"] = owner_email
    msg.set_content(
        f"Hi {owner_name},\n\n"
        f"Your company {company_name} has been approved on MechTrack Pulse.\n\n"
        f"Temporary password: {temp_password}\n\n"
        "Use your email address and this temporary password to sign in.\n"
        "On your first login, you will be required to change the password "
        "before accessing the dashboard.\n\n"
        "MechTrack Pulse"
    )
    return _dispatch(msg)


def send_user_welcome_email(
    *,
    user_name: str,
    user_email: str,
    company_name: str,
    role: str,
    temp_password: str,
) -> tuple[bool, str]:
    """Send user onboarding email with generated temp password (operators/supervisors/clients)."""
    msg = EmailMessage()
    msg["Subject"] = f"Welcome to MechTrack Pulse — {company_name}"
    msg["From"] = _from_header()
    msg["To"] = user_email
    msg.set_content(
        f"Hi {user_name},\n\n"
        f"You have been granted {role} access to {company_name}'s "
        f"MechTrack Pulse platform.\n\n"
        f"Your temporary password: {temp_password}\n\n"
        "Use your email address and this temporary password to sign in. "
        "You will be required to choose a secure password upon your first login.\n\n"
        "MechTrack Pulse"
    )
    return _dispatch(msg)


def send_password_reset_email(
    *,
    user_email: str,
    reset_link: str,
) -> tuple[bool, str]:
    """Send password reset link to user."""
    msg = EmailMessage()
    msg["Subject"] = "MechTrack Pulse — Password Reset"
    msg["From"] = _from_header()
    msg["To"] = user_email
    msg.set_content(
        "We received a request to reset the password for your MechTrack Pulse account.\n\n"
        "Click the link below to reset your password. This link will expire in 15 minutes.\n\n"
        f"{reset_link}\n\n"
        "If you did not request this, you can safely ignore this email.\n\n"
        "MechTrack Pulse Security"
    )
    return _dispatch(msg)
