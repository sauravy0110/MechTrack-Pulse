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
from html import escape, unescape
import smtplib
import ssl
import logging
import re

import requests

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger("app.email")
EMAIL_LOGO_PATH = "/mechtrack-email-logo.svg"


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


def _public_app_url() -> str:
    value = (
        _clean_env_value(settings.PUBLIC_APP_URL)
        or _clean_env_value(settings.OPENROUTER_SITE_URL)
        or "https://mech-track-pulse.vercel.app"
    )
    return value.rstrip("/")


def _brand_asset_url(path: str) -> str:
    return f"{_public_app_url()}/{path.lstrip('/')}"


def _html_to_plain_text(value: str) -> str:
    normalized = re.sub(r"<br\s*/?>", "\n", value, flags=re.IGNORECASE)
    normalized = re.sub(r"</(p|div|li|tr|h[1-6])>", "\n", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"<[^>]+>", "", normalized)
    normalized = unescape(normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()


def _get_plain_body(message: EmailMessage) -> str:
    if message.is_multipart():
        for part in message.walk():
            if part.get_content_maintype() == "multipart":
                continue
            if part.get_content_disposition() == "attachment":
                continue
            if part.get_content_subtype() == "plain":
                content = part.get_content()
                if isinstance(content, str) and content.strip():
                    return content
        html_body = _get_html_body(message)
        return _html_to_plain_text(html_body) if html_body else ""

    content = message.get_content()
    if message.get_content_subtype() == "html":
        return _html_to_plain_text(content)
    return content


def _get_html_body(message: EmailMessage) -> str | None:
    if message.is_multipart():
        for part in message.walk():
            if part.get_content_maintype() == "multipart":
                continue
            if part.get_content_disposition() == "attachment":
                continue
            if part.get_content_subtype() == "html":
                content = part.get_content()
                if isinstance(content, str) and content.strip():
                    return content
        return None

    if message.get_content_subtype() == "html":
        content = message.get_content()
        return content if isinstance(content, str) and content.strip() else None
    return None


def _render_email_shell(
    *,
    eyebrow: str,
    title: str,
    intro_html: str,
    body_html: str,
    cta_label: str | None = None,
    cta_href: str | None = None,
    footer_note: str | None = None,
) -> str:
    logo_url = _brand_asset_url(EMAIL_LOGO_PATH)
    website_url = _public_app_url()
    login_url = f"{website_url}/login"
    cta_html = ""
    if cta_label and cta_href:
        cta_html = (
            f'<a href="{escape(cta_href, quote=True)}" '
            'style="display:inline-block;padding:14px 24px;border-radius:999px;'
            'background:linear-gradient(135deg,#103f52,#2f88a4);color:#f7f8fa;'
            'font-size:14px;font-weight:700;letter-spacing:0.02em;'
            'text-decoration:none;box-shadow:0 18px 34px rgba(16,63,82,0.24);">'
            f"{escape(cta_label)}</a>"
        )

    note_html = (
        f'<p style="margin:18px 0 0;color:#5f6d74;font-size:13px;line-height:1.6;">{escape(footer_note)}</p>'
        if footer_note
        else ""
    )

    return f"""\
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;background:#eef3f5;color:#0f1f29;font-family:'Segoe UI',Arial,sans-serif;">
    <div style="padding:28px 14px;">
      <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid rgba(16,63,82,0.12);border-radius:28px;overflow:hidden;box-shadow:0 30px 70px rgba(8,24,32,0.12);">
        <div style="padding:28px 32px 24px;background:linear-gradient(180deg,#f5fafb 0%,#ffffff 100%);border-bottom:1px solid rgba(16,63,82,0.08);">
          <img src="{escape(logo_url, quote=True)}" alt="MechTrackPulse" width="300" style="display:block;width:100%;max-width:300px;height:auto;margin:0 auto 22px;" />
          <p style="margin:0 0 10px;color:#2f88a4;font-size:11px;font-weight:700;letter-spacing:0.26em;text-transform:uppercase;text-align:center;">{escape(eyebrow)}</p>
          <h1 style="margin:0;color:#103f52;font-size:30px;line-height:1.15;text-align:center;">{escape(title)}</h1>
        </div>

        <div style="padding:32px;">
          <div style="color:#30424a;font-size:15px;line-height:1.75;">
            {intro_html}
            <div style="margin:20px 0 0;padding:24px;border:1px solid rgba(16,63,82,0.1);border-radius:22px;background:linear-gradient(180deg,#fbfcfd 0%,#f3f8f9 100%);">
              {body_html}
            </div>
          </div>

          <div style="margin-top:28px;text-align:center;">
            {cta_html}
            {note_html}
          </div>
        </div>

        <div style="padding:24px 32px;background:#0f2732;color:#d7e9ee;text-align:center;">
          <img src="{escape(logo_url, quote=True)}" alt="MechTrackPulse" width="220" style="display:block;width:100%;max-width:220px;height:auto;margin:0 auto 16px;filter:brightness(1.08);" />
          <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:#7dc6db;">Precision. Progress. Performance.</p>
          <p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#c5d7dd;">
            Manufacturing visibility, task control, and performance intelligence in one workspace.
          </p>
          <p style="margin:0;font-size:13px;line-height:1.8;">
            <a href="{escape(website_url, quote=True)}" style="color:#ffffff;text-decoration:none;font-weight:700;">Visit Website</a>
            <span style="display:inline-block;margin:0 10px;color:#5da8bf;">•</span>
            <a href="{escape(login_url, quote=True)}" style="color:#7dc6db;text-decoration:none;font-weight:700;">Open Dashboard</a>
          </p>
        </div>
      </div>
    </div>
  </body>
</html>
"""


def _set_email_content(message: EmailMessage, plain_body: str, html_body: str) -> None:
    message.set_content(plain_body)
    message.add_alternative(html_body, subtype="html")


def _try_resend(to: str, subject: str, body: str, html_body: str | None = None) -> tuple[bool, str]:
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
    if html_body:
        payload["html"] = html_body
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


def _try_brevo(to: str, subject: str, body: str, html_body: str | None = None) -> tuple[bool, str]:
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
    if html_body:
        payload["htmlContent"] = html_body

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
    body = _get_plain_body(message)
    html_body = _get_html_body(message)
    errors: list[str] = []

    # 1️⃣  Brevo HTTP API  (Best free option — can email anyone)
    ok, err = _try_brevo(to, subject, body, html_body)
    if ok:
        return True, ""
    if err:
        errors.append(err)

    # 2️⃣  Resend HTTP API  (Requires domain verification to email anyone)
    ok, err = _try_resend(to, subject, body, html_body)
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
    website_url = _public_app_url()
    login_url = f"{website_url}/login"
    plain_body = (
        f"Hi {owner_name},\n\n"
        f"Your company {company_name} has been approved on MechTrack Pulse.\n\n"
        f"Temporary password: {temp_password}\n\n"
        "Use your email address and this temporary password to sign in.\n"
        "On your first login, you will be required to change your password before accessing the dashboard.\n\n"
        f"Sign in: {login_url}\n"
        f"Website: {website_url}\n\n"
        "MechTrack Pulse\n"
        "Precision. Progress. Performance."
    )
    html_body = _render_email_shell(
        eyebrow="Company Approved",
        title=f"{company_name} is ready to go",
        intro_html=(
            f"<p style=\"margin:0 0 14px;\">Hi <strong>{escape(owner_name)}</strong>,</p>"
            f"<p style=\"margin:0;\">Your company <strong>{escape(company_name)}</strong> has been approved on MechTrack Pulse. "
            "Your owner workspace is ready, and the temporary access details are below.</p>"
        ),
        body_html=(
            '<p style="margin:0 0 14px;font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#2f88a4;font-weight:700;">Owner Access</p>'
            f'<p style="margin:0 0 10px;font-size:15px;color:#30424a;">Sign in with <strong>{escape(owner_email)}</strong></p>'
            f'<p style="margin:0;padding:16px 18px;border-radius:18px;background:#0f2732;color:#f7fbfc;font-size:18px;font-weight:700;letter-spacing:0.06em;">{escape(temp_password)}</p>'
            '<p style="margin:14px 0 0;font-size:14px;color:#5f6d74;">For security, you will be prompted to change this password on your first login.</p>'
        ),
        cta_label="Open Dashboard",
        cta_href=login_url,
        footer_note="Need access right away? Sign in with your email and the temporary password shown above.",
    )
    msg = EmailMessage()
    msg["Subject"] = f"{company_name} has been approved on MechTrack Pulse"
    msg["From"] = _from_header()
    msg["To"] = owner_email
    _set_email_content(msg, plain_body, html_body)
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
    website_url = _public_app_url()
    login_url = f"{website_url}/login"
    plain_body = (
        f"Hi {user_name},\n\n"
        f"You have been granted {role} access to {company_name}'s MechTrack Pulse platform.\n\n"
        f"Temporary password: {temp_password}\n\n"
        "Use your email address and this temporary password to sign in. "
        "You will be required to choose a secure password upon your first login.\n\n"
        f"Sign in: {login_url}\n"
        f"Website: {website_url}\n\n"
        "MechTrack Pulse\n"
        "Precision. Progress. Performance."
    )
    html_body = _render_email_shell(
        eyebrow="Team Access Granted",
        title=f"Welcome to {company_name}",
        intro_html=(
            f"<p style=\"margin:0 0 14px;\">Hi <strong>{escape(user_name)}</strong>,</p>"
            f"<p style=\"margin:0;\">You now have <strong>{escape(role.title())}</strong> access to "
            f"<strong>{escape(company_name)}</strong> on MechTrack Pulse. Your temporary sign-in details are ready below.</p>"
        ),
        body_html=(
            f'<p style="margin:0 0 12px;font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#2f88a4;font-weight:700;">{escape(role.title())} Access</p>'
            f'<p style="margin:0 0 10px;font-size:15px;color:#30424a;">Sign in with <strong>{escape(user_email)}</strong></p>'
            f'<p style="margin:0;padding:16px 18px;border-radius:18px;background:#0f2732;color:#f7fbfc;font-size:18px;font-weight:700;letter-spacing:0.06em;">{escape(temp_password)}</p>'
            '<p style="margin:14px 0 0;font-size:14px;color:#5f6d74;">You will be prompted to choose a secure password after your first login.</p>'
        ),
        cta_label="Sign In",
        cta_href=login_url,
        footer_note="Your MechTrack Pulse workspace includes live updates, task visibility, and performance tracking.",
    )
    msg = EmailMessage()
    msg["Subject"] = f"Welcome to MechTrack Pulse — {company_name}"
    msg["From"] = _from_header()
    msg["To"] = user_email
    _set_email_content(msg, plain_body, html_body)
    return _dispatch(msg)


def send_password_reset_email(
    *,
    user_email: str,
    reset_link: str,
) -> tuple[bool, str]:
    """Send password reset link to user."""
    website_url = _public_app_url()
    plain_body = (
        "We received a request to reset the password for your MechTrack Pulse account.\n\n"
        "Click the link below to reset your password. This link will expire in 15 minutes.\n\n"
        f"{reset_link}\n\n"
        "If you did not request this, you can safely ignore this email.\n\n"
        f"Website: {website_url}\n\n"
        "MechTrack Pulse Security\n"
        "Precision. Progress. Performance."
    )
    html_body = _render_email_shell(
        eyebrow="Password Reset",
        title="Reset your password securely",
        intro_html=(
            "<p style=\"margin:0 0 14px;\">We received a request to reset the password for your MechTrack Pulse account.</p>"
            "<p style=\"margin:0;\">Use the secure link below to choose a new password and regain access to your dashboard.</p>"
        ),
        body_html=(
            '<p style="margin:0 0 12px;font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#2f88a4;font-weight:700;">Secure Access</p>'
            '<p style="margin:0;font-size:15px;color:#30424a;">This password reset link will expire in <strong>15 minutes</strong>.</p>'
            '<p style="margin:12px 0 0;font-size:14px;color:#5f6d74;">If you did not request this change, you can safely ignore this email and your password will remain unchanged.</p>'
        ),
        cta_label="Reset Password",
        cta_href=reset_link,
        footer_note="Password reset links are single-use and protected for account security.",
    )
    msg = EmailMessage()
    msg["Subject"] = "MechTrack Pulse — Password Reset"
    msg["From"] = _from_header()
    msg["To"] = user_email
    _set_email_content(msg, plain_body, html_body)
    return _dispatch(msg)
