"""
MechTrack Pulse — Email Delivery Service

Small SMTP wrapper used for approval onboarding emails.
"""

from email.message import EmailMessage
import smtplib
import ssl

from app.core.config import get_settings

settings = get_settings()


def send_owner_welcome_email(
    *,
    owner_name: str,
    owner_email: str,
    company_name: str,
    temp_password: str,
) -> tuple[bool, str]:
    """
    Send owner onboarding email with the generated temp password.

    Returns (sent, error_message).
    """
    if not settings.SMTP_HOST:
        return False, "SMTP is not configured."

    message = EmailMessage()
    message["Subject"] = f"{company_name} has been approved on MechTrack Pulse"
    message["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
    message["To"] = owner_email
    message.set_content(
        "\n".join(
            [
                f"Hi {owner_name},",
                "",
                f"Your company {company_name} has been approved on MechTrack Pulse.",
                "",
                f"Temporary password: {temp_password}",
                "",
                "Use your email address and this temporary password to sign in.",
                "On your first login, you will be required to change the password before accessing the dashboard.",
                "",
                "If you were not expecting this email, please contact your platform administrator.",
                "",
                "MechTrack Pulse",
            ]
        )
    )

    try:
        if settings.SMTP_USE_SSL:
            with smtplib.SMTP_SSL(
                settings.SMTP_HOST,
                settings.SMTP_PORT,
                timeout=20,
                context=ssl.create_default_context(),
            ) as server:
                if settings.SMTP_USERNAME:
                    server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD or "")
                server.send_message(message)
        else:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as server:
                server.ehlo()
                if settings.SMTP_USE_TLS:
                    server.starttls(context=ssl.create_default_context())
                    server.ehlo()
                if settings.SMTP_USERNAME:
                    server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD or "")
                server.send_message(message)
    except Exception as exc:
        return False, str(exc)

    return True, ""
