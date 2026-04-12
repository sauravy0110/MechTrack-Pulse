import os
import sys
from email.message import EmailMessage


os.environ.setdefault("DATABASE_URL", "sqlite:///./email_service_unit.db")
os.environ.setdefault("SECRET_KEY", "testsecret")
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.services import email_service


def test_try_brevo_uses_cleaned_key_and_sender(monkeypatch):
    monkeypatch.setattr(email_service.settings, "BREVO_API_KEY", ' "xkeysib-test-key" ')
    monkeypatch.setattr(email_service.settings, "BREVO_SENDER_EMAIL", " verified@mechtrackpulse.com ")
    monkeypatch.setattr(email_service.settings, "BREVO_SENDER_NAME", ' "MechTrack Alerts" ')
    monkeypatch.setattr(email_service.settings, "SMTP_FROM_EMAIL", "fallback@example.com")
    monkeypatch.setattr(email_service.settings, "SMTP_FROM_NAME", "Fallback Sender")

    captured: dict = {}

    class FakeResponse:
        status_code = 202
        text = ""

        def json(self):
            return {"message": "accepted"}

    def fake_post(url, json=None, headers=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr(email_service.requests, "post", fake_post)

    ok, err = email_service._try_brevo("user@example.com", "Subject", "Body", "<p>Body</p>")

    assert ok is True
    assert err == ""
    assert captured["url"] == "https://api.brevo.com/v3/smtp/email"
    assert captured["headers"]["api-key"] == "xkeysib-test-key"
    assert captured["json"]["sender"]["email"] == "verified@mechtrackpulse.com"
    assert captured["json"]["sender"]["name"] == "MechTrack Alerts"
    assert captured["json"]["to"] == [{"email": "user@example.com"}]
    assert captured["json"]["htmlContent"] == "<p>Body</p>"


def test_dispatch_returns_failure_when_only_console_fallback_is_available(monkeypatch):
    monkeypatch.setattr(email_service, "_try_brevo", lambda *_args: (False, "BREVO_API_KEY not configured"))
    monkeypatch.setattr(email_service, "_try_resend", lambda *_args: (False, "RESEND_API_KEY not configured"))
    monkeypatch.setattr(email_service, "_try_smtp", lambda *_args: (False, "SMTP credentials incomplete"))
    monkeypatch.setattr(
        email_service,
        "_console_fallback",
        lambda *_args: "Console fallback only (message printed to server logs)",
    )

    message = EmailMessage()
    message["To"] = "owner@example.com"
    message["Subject"] = "Welcome"
    message.set_content("Hello there")

    sent, error = email_service._dispatch(message)

    assert sent is False
    assert "BREVO_API_KEY not configured" in error
    assert "RESEND_API_KEY not configured" in error
    assert "SMTP credentials incomplete" in error
    assert "Console fallback only" in error


def test_dispatch_preserves_html_for_http_transports(monkeypatch):
    captured: dict = {}

    def fake_brevo(to, subject, body, html_body):
        captured["to"] = to
        captured["subject"] = subject
        captured["body"] = body
        captured["html_body"] = html_body
        return True, ""

    monkeypatch.setattr(email_service, "_try_brevo", fake_brevo)

    message = EmailMessage()
    message["To"] = "owner@example.com"
    message["Subject"] = "Welcome"
    message.set_content("Plain body")
    message.add_alternative("<p>Rich body</p>", subtype="html")

    sent, error = email_service._dispatch(message)

    assert sent is True
    assert error == ""
    assert captured["to"] == "owner@example.com"
    assert captured["subject"] == "Welcome"
    assert captured["body"] == "Plain body\n"
    assert captured["html_body"] == "<p>Rich body</p>\n"
