#!/usr/bin/env python3
"""
Push the day's leads from the daily routine into the leads app.

Copy this into the nearwork-lead-agent project and call it at the end of deliver.sh
(after make_xlsx). It reads leads_ledger.json and POSTs to <LEADS_APP_URL>/api/ingest.

Env (add to the routine's .env):
  LEADS_APP_URL   e.g. https://leads.nearwork.co
  INGEST_SECRET   same value set in the Vercel project
  LEDGER_PATH     optional; defaults to ./leads_ledger.json
"""
import json
import os
import subprocess

APP = os.environ.get("LEADS_APP_URL", "").rstrip("/")
SECRET = os.environ.get("INGEST_SECRET", "")
LEDGER = os.environ.get("LEDGER_PATH", "leads_ledger.json")

DROP_REASONS = {"Unsubscribed", "do-not-contact"}


def _status(e):
    n = int(e.get("hs_touches", 0) or 0)
    if n < 1 and (e.get("manual") or e.get("sent_date")):
        n = 1
    if e.get("won"):
        return "Won", n
    if e.get("stop_reason") == "HubSpot deal":
        return "Deal", n
    if e.get("replied"):
        return "Replied", n
    return ("Sent" if n > 0 else "New"), n


def main():
    if not (APP and SECRET):
        print("push_leads: LEADS_APP_URL / INGEST_SECRET not set — skipping.")
        return
    ledger = json.load(open(LEDGER))
    leads = []
    for e in ledger:
        if e.get("stop") and e.get("stop_reason") in DROP_REASONS:
            continue
        status, n = _status(e)
        email = e.get("email") or ""
        leads.append({
            "company": e.get("company"),
            "domain": email.split("@")[-1] if "@" in email else None,
            "owner": e.get("owner"),
            "role": e.get("role"),
            "email": email or None,
            "email_confidence": e.get("confidence"),
            "status": status,
            "sent_count": n,
            "why_now": e.get("why_now"),
            "job_url": e.get("url"),
            "last_activity": (e.get("hs_last_contacted") or e.get("sent_date") or e.get("date") or "")[:10] or None,
        })
    body = json.dumps({"leads": leads})
    out = subprocess.run(
        ["curl", "-s", "--max-time", "60", "-X", "POST", f"{APP}/api/ingest",
         "-H", f"x-ingest-secret: {SECRET}", "-H", "Content-Type: application/json", "-d", body],
        capture_output=True, text=True).stdout
    print("push_leads ->", out[:200])


if __name__ == "__main__":
    main()
