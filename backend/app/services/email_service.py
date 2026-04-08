"""
MechTrack Pulse — Email Delivery Service

Small SMTP wrapper used for onboarding emails and password resets.
If SMTP is not configured in .env, it defaults to printing the email configuration to the console.
"""

from email.message import EmailMessage
import smtplib
import ssl

from app.core.config import get_settings

settings = get_settings()

def _send_email_or_print(message: EmailMessage) -> tuple[bool, str]:
    if not settings.SMTP_HOST:
        print("\n" + "="*50)
        print("MOCK EMAIL DISPATCH (SMTP NOT CONFIGURED)")
        print(f"To: {message['To']}")
        print(f"Subject: {message['Subject']}")
        print("-" * 50)
        print(message.get_content())
        print("="*50 + "\n")
        return True, "Mock email dispatched to console"

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
        print(f"SMTP Error: {exc}")
        return False, str(exc)

    return True, ""


def send_owner_welcome_email(
    *,
    owner_name: str,
    owner_email: str,
    company_name: str,
    temp_password: str,
) -> tuple[bool, str]:
    """Send owner onboarding email with the generated temp password."""
    message = EmailMessage()
    message["Subject"] = f"{company_name} has been approved on MechTrack Pulse"
    message["From"] = f"{settings.SMTP_FROM_NAME or 'MechTrack'} <{settings.SMTP_FROM_EMAIL or 'noreply@mechtrack.com'}>"
    message["To"] = owner_email
    message.set_content(
        "\n".join([
            f"Hi {owner_name},",
            "",
            f"Your company {company_name} has been approved on MechTrack Pulse.",
            "",
            f"Temporary password: {temp_password}",
            "",
            "Use your email address and this temporary password to sign in.",
            "On your first login, you will be required to change the password before accessing the dashboard.",
            "",
            "MechTrack Pulse",
        ])
    )
    return _send_email_or_print(message)


def send_user_welcome_email(
    *,
    user_name: str,
    user_email: str,
    company_name: str,
    role: str,
    temp_password: str,
) -> tuple[bool, str]:
    """Send user onboarding email with the generated temp password (for operators/supervisors)."""
    message = EmailMessage()
    message["Subject"] = f"Welcome to MechTrack Pulse — {company_name}"
    message["From"] = f"{settings.SMTP_FROM_NAME or 'MechTrack'} <{settings.SMTP_FROM_EMAIL or 'noreply@mechtrack.com'}>"
    message["To"] = user_email
    message.set_content(
        "\n".join([
            f"Hi {user_name},",
            "",
            f"You have been granted {role} access to {company_name}'s MechTrack Pulse platform.",
            "",
            f"Your temporary password: {temp_password}",
            "",
            "Use your email address and this temporary password to sign in. "
            "You will be required to choose a secure password upon your first login.",
            "",
            "MechTrack Pulse",
        ])
    )
    return _send_email_or_print(message)


def send_password_reset_email(
    *,
    user_email: str,
    reset_link: str,
) -> tuple[bool, str]:
    """Send password reset link to user."""
    message = EmailMessage()
    message["Subject"] = "MechTrack Pulse — Password Reset"
    message["From"] = f"{settings.SMTP_FROM_NAME or 'MechTrack'} <{settings.SMTP_FROM_EMAIL or 'noreply@mechtrack.com'}>"
    message["To"] = user_email
    message.set_content(
        "\n".join([
            "We received a request to reset the password for your MechTrack Pulse account.",
            "",
            "Click the link below to reset your password. This link will expire in 15 minutes.",
            "",
            reset_link,
            "",
            "If you did not request this, you can safely ignore this email.",
            "",
            "MechTrack Pulse Security",
        ])
    )
    return _send_email_or_print(message)
