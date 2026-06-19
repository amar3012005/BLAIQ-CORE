"""Job notifications (Track A6).

A pluggable notifier: records every notification to ``ops.notifications`` and,
when a real channel is configured (future: SMTP / Protonet), attempts to send
and marks the row ``sent``/``failed``. Until then notifications are ``logged``
so delivery notices and payment reminders are fully auditable with no external
provider — which keeps the workflow testable end-to-end.
"""

from __future__ import annotations

import asyncio
import logging
import os
import smtplib
import ssl
from email.mime.text import MIMEText
from typing import Any

from sqlalchemy import text

from aiteam.storage.connection import current_tenant_id, get_session

logger = logging.getLogger(__name__)


def _email_config() -> dict[str, Any] | None:
    """Return SMTP config iff the email channel is explicitly enabled AND a
    host + sender are set. Otherwise None → notifications stay 'logged'.

    SAFETY: BLAIQ_NOTIFY_REDIRECT_TO, when set, routes EVERY send to that single
    operator inbox regardless of the intended recipient. This is the default-safe
    posture — the operator must remove the redirect (and supply a real recipient)
    before anything reaches an actual client. Lets us prove the channel works
    end-to-end without ever emailing a real B&B client.
    """
    if os.environ.get("BLAIQ_NOTIFY_EMAIL_ENABLED", "").strip().lower() not in ("1", "true", "yes"):
        return None
    host = os.environ.get("BLAIQ_NOTIFY_SMTP_HOST", "").strip()
    sender = os.environ.get("BLAIQ_NOTIFY_FROM", "").strip()
    if not host or not sender:
        return None
    return {
        "host": host,
        "port": int(os.environ.get("BLAIQ_NOTIFY_SMTP_PORT", "587") or 587),
        "user": os.environ.get("BLAIQ_NOTIFY_SMTP_USER", "").strip(),
        "password": os.environ.get("BLAIQ_NOTIFY_SMTP_PASS", ""),
        "sender": sender,
        "redirect_to": os.environ.get("BLAIQ_NOTIFY_REDIRECT_TO", "").strip(),
    }


def _send_email_sync(cfg: dict[str, Any], to: str | None, subject: str, body: str) -> tuple[bool, str]:
    recipient = cfg["redirect_to"] or (to or "").strip()
    if not recipient:
        return False, "no recipient (set BLAIQ_NOTIFY_REDIRECT_TO or pass a client email)"
    msg = MIMEText(body or subject, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = cfg["sender"]
    msg["To"] = recipient
    if cfg["redirect_to"] and to and cfg["redirect_to"] != to:
        msg["X-BLAIQ-Intended-Recipient"] = to  # transparency: who it would have gone to
    ctx = ssl.create_default_context()
    with smtplib.SMTP(cfg["host"], cfg["port"], timeout=20) as s:
        s.ehlo()
        try:
            s.starttls(context=ctx)
            s.ehlo()
        except smtplib.SMTPNotSupportedError:
            pass  # server without STARTTLS (e.g. local debug)
        if cfg["user"]:
            s.login(cfg["user"], cfg["password"])
        s.sendmail(cfg["sender"], [recipient], msg.as_string())
    return True, recipient


async def record_notification(
    tenant_id: str,
    *,
    kind: str,
    subject: str,
    body: str = "",
    job_id: str | None = None,
    channel: str = "log",
    to: str | None = None,
) -> str:
    """Persist (and, when the email channel is configured, send) a notification.

    Returns the status: 'sent' when actually emailed, 'failed' on send error,
    'logged' when no channel is configured (the safe default). Caller may already
    hold the tenant ContextVar; we set it explicitly so the RLS INSERT works
    whether called from a request or a background task.
    """
    status = "logged"
    cfg = _email_config()
    if cfg is not None:
        try:
            ok, info = await asyncio.get_event_loop().run_in_executor(
                None, _send_email_sync, cfg, to, subject, body
            )
            if ok:
                status, channel = "sent", "email"
                logger.info("notification emailed to %s (kind=%s)", info, kind)
            else:
                logger.info("notification not sent (%s); recording logged", info)
        except Exception as exc:  # noqa: BLE001 — never let a send failure lose the record
            status = "failed"
            logger.warning("notification email send failed: %s", exc)
    token = current_tenant_id.set(tenant_id)
    try:
        async with get_session() as session:
            await session.execute(
                text(
                    "INSERT INTO ops.notifications "
                    "(tenant_id, job_id, kind, channel, subject, body, status) "
                    "VALUES (CAST(:tid AS uuid), CAST(:job_id AS uuid), :kind, :channel, "
                    ":subject, :body, :status)"
                ),
                {
                    "tid": tenant_id,
                    "job_id": job_id,
                    "kind": kind,
                    "channel": channel,
                    "subject": subject,
                    "body": body,
                    "status": status,
                },
            )
    finally:
        current_tenant_id.reset(token)
    logger.info(
        "notification recorded: kind=%s status=%s job=%s tenant=%s",
        kind, status, job_id, tenant_id,
    )
    return status


async def list_job_notifications(tenant_id: str, job_id: str) -> list[dict[str, Any]]:
    """Return notifications for a job, newest first (RLS-scoped)."""
    token = current_tenant_id.set(tenant_id)
    try:
        async with get_session() as session:
            rows = (
                await session.execute(
                    text(
                        "SELECT id, kind, channel, subject, body, status, created_at "
                        "FROM ops.notifications WHERE job_id = CAST(:job_id AS uuid) "
                        "ORDER BY created_at DESC LIMIT 100"
                    ),
                    {"job_id": job_id},
                )
            ).all()
    finally:
        current_tenant_id.reset(token)
    return [
        {
            "id": int(r[0]),
            "kind": r[1],
            "channel": r[2],
            "subject": r[3],
            "body": r[4],
            "status": r[5],
            "created_at": r[6].isoformat() if r[6] else None,
        }
        for r in rows
    ]
