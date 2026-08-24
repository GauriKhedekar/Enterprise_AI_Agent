"""Transactional email via Resend. Degrades to log-only when no API key is configured."""
import asyncio
import logging
import os

logger = logging.getLogger(__name__)


def _sender() -> str:
    return os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")


async def send_email(recipient_email: str, subject: str, html_content: str) -> bool:
    """Returns True when Resend accepted the message, False when email is not configured."""
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key:
        logger.warning("RESEND_API_KEY not set — skipping email to %s (%s)", recipient_email, subject)
        return False
    try:
        import resend

        resend.api_key = api_key
        params = {
            "from": _sender(),
            "to": [recipient_email],
            "subject": subject,
            "html": html_content,
        }
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info("Resend accepted email %s to %s", result.get("id"), recipient_email)
        return True
    except Exception as exc:  # pragma: no cover - network dependent
        logger.error("Failed to send email to %s: %s", recipient_email, exc)
        return False


def invite_email_html(company_name: str, employee_code: str, invite_url: str) -> str:
    return f"""
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0b0d13;padding:32px 0;font-family:Arial,Helvetica,sans-serif">
  <tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#11141d;border:1px solid #1e2433;border-radius:12px;padding:32px">
      <tr><td style="color:#ffffff;font-size:20px;font-weight:600;padding-bottom:8px">
        You have been invited to {company_name}
      </td></tr>
      <tr><td style="color:#9ca3af;font-size:14px;line-height:22px;padding-bottom:20px">
        Adaptive Enterprise Agent is your internal compliance assistant. Your employee code is
        <strong style="color:#c7d2fe">{employee_code}</strong>. Set a password to activate your account.
      </td></tr>
      <tr><td style="padding-bottom:20px">
        <a href="{invite_url}" style="background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px;display:inline-block">
          Set your password
        </a>
      </td></tr>
      <tr><td style="color:#64748b;font-size:12px;word-break:break-all">{invite_url}</td></tr>
    </table>
  </td></tr>
</table>
"""
