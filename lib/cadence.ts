/**
 * THE REAL NEARWORK CADENCE.
 *
 * Byron 2026-08-08: the design handoff ships the LOOK; the sequence below is what
 * the live engine actually does. Do not adopt the prototype's 0/2/4/7/10/14 table —
 * these values mirror `outreach_spec.py`, `daily_send_plan.py` and `call_list.py`,
 * and must stay in step with them.
 *
 *   Manual / Outlook leads (Variant C, price-first):
 *     Day 0                       First email
 *     +3 business days            Follow-up 1
 *     +2 business days after FU1  Call #1        (call_list.CALL_BUFFER_BIZDAYS)
 *     +3 business days after FU1  Follow-up 2 — final, then stop
 *     +2 / +3 business days       Call #2 / #3   (call_list.GAP_AFTER_CALL, max 3)
 *
 *   Apollo A/B leads: 4 touches on days 0 / 3 / 7 / 12 (outreach_spec.CADENCE_DAYS).
 */

export const FU_BIZDAYS = 3;        // daily_send_plan.FU_MIN_BIZDAYS
export const CALL_BUFFER = 2;       // call_list.CALL_BUFFER_BIZDAYS
export const GAP_AFTER_CALL = [2, 3];
export const MAX_CALL_ATTEMPTS = 3; // call_list.MAX_ATTEMPTS
export const EMAIL_TOUCHES = 3;     // first + FU1 + FU2 (Variant C)
export const APOLLO_CADENCE = [0, 3, 7, 12];

// NEW LEADS ARE NEVER CAPPED. Byron 2026-08-10: "New leads, send what you have for
// that day. If you send me 200, and I only send 40, the 160 will continue in the list
// + the new leads on the next day." So the new-lead queue is a BACKLOG he works down,
// not a daily allowance — showing him fewer than exist just hides pipeline.
//
// FOLLOW-UPS ARE CAPPED, because they are time-sensitive and pile up in bursts:
// "we can send 50 follow ups or 80, but not 200 follow ups."
export const FU_DAILY_MIN = 30;     // a normal day
export const FU_DAILY_MAX = 80;     // Byron's stated ceiling — never exceed
export const FU_CATCHUP_DAYS = 3;   // clear a backlog over this many days, not in one hit

/**
 * How many follow-ups to surface today. Scales with the size of the backlog so a
 * quiet day stays quiet and a 200-deep pile drains over FU_CATCHUP_DAYS instead of
 * landing on one morning — but never above the ceiling Byron gave.
 */
export function followUpBudget(backlog: number): number {
  if (backlog <= FU_DAILY_MIN) return backlog;
  return Math.min(FU_DAILY_MAX, Math.max(FU_DAILY_MIN, Math.ceil(backlog / FU_CATCHUP_DAYS)));
}

export const MAX_CALLS_PER_DAY = 40; // call_list.DAILY_CALL_CAP

export const MY_TZ = -5;            // Bogotá (COT)

export type Step = {
  kind: "email" | "call";
  label: string;
  due: Date;
  done: boolean;
  n: number;
};

export type Lead = {
  id: number;
  company: string;
  owner: string | null;
  role: string | null;
  contact_name: string | null;
  contact_title: string | null;
  phone: string | null;
  linkedin: string | null;   // profile URL, found by find_linkedin.py
  linkedin_stage: string | null;  // null | 'connect' | 'message'
  linkedin_at: string | null;
  linkedin_by: string | null;   // which rep took it — two SDRs must not double-touch
  email: string | null;
  email_confidence: string | null;
  status: string;
  sent_count: number;
  tz_offset: number | null;
  dnc: boolean;
  started: string | null;
  last_activity: string | null;
  callback_date: string | null;
  callback_time: string | null;
  source: string | null;
  sprint_name: string | null;
  ab_variant: string | null;
  job_url: string | null;
  website: string | null;
  gen_subject: string | null;
  gen_body: string | null;
  opened: boolean;
  call_count: number;
  last_call_at: string | null;
};

/** Deal/Won collapse to Replied; "No" reads as "Not interested". */
export function norm(status: string): string {
  if (["Deal", "Won", "Replied"].includes(status)) return "Replied";
  return status;
}

export function statusLabel(status: string): string {
  const s = norm(status);
  return s === "No" ? "Not interested" : s;
}

function startOfToday(): Date {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

/** Weekends aren't send days — roll forward to Monday. */
function bumpToBizDay(from: Date): Date {
  const d = new Date(from);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

function addBizDays(from: Date, n: number): Date {
  const d = new Date(from);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return d;
}

/**
 * Postgres hands back "2026-08-04T00:00:00.000Z". `new Date()` on that lands at
 * 19:00 the PREVIOUS day in Bogotá, so every lead looked a day older than it was
 * and follow-ups fired early (Byron 2026-08-09: "why does it show 98 due"). Read
 * the calendar date off the string and build a LOCAL date instead.
 */
export function localDate(iso: string | Date | null): Date | null {
  if (!iso) return null;
  // A Date INSTANCE reaches us from the server component: Next.js preserves real
  // Date objects through the RSC payload, whereas /api/cc has been through
  // JSON.stringify and arrives as a string. Both describe the same Postgres
  // `date`, stored as UTC midnight — but `new Date("2026-08-07T00:00:00Z")` is
  // Aug 6 19:00 in Bogotá, so passing the instance through untouched made every
  // lead read a day older than it is.
  //
  // That is why one click emptied the whole page (Byron 2026-08-11): the initial
  // server render said 63 follow-ups were due, the refresh said 0. Same data,
  // same function, different TYPE. Read the UTC calendar date in both cases.
  if (iso instanceof Date) {
    return isNaN(iso.getTime())
      ? null
      : new Date(iso.getUTCFullYear(), iso.getUTCMonth(), iso.getUTCDate());
  }
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? null
    : new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function bizDaysSince(iso: string | null): number {
  const start = localDate(iso);
  if (!start) return 99;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let n = 0;
  const cur = new Date(start);
  while (cur < today) {
    cur.setDate(cur.getDate() + 1);
    if (cur.getDay() !== 0 && cur.getDay() !== 6) n++;
  }
  return n;
}

/**
 * The lead's full schedule as dated steps — visible in the drawer, never editable.
 * Emails are marked done from sent_count; calls from call_count.
 */
export function schedule(l: Lead): Step[] {
  const sent = l.sent_count || 0;
  const calls = l.call_count || 0;

  // Byron 2026-08-09: "if it says send on Aug 11 but I send on Aug 13, adjust
  // the other days from the last time I sent." So the plan is NOT fixed to the
  // first touch — every step still to come is measured forward from the most
  // recent REAL activity. Send late and everything after it slides with you;
  // send early and it tightens up.
  const lastEmail = localDate(l.last_activity);
  const lastCall = localDate(l.last_call_at);
  const started = localDate(l.started);
  let cursor =
    [lastEmail, lastCall].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0]
    || started || new Date();

  const plan: { kind: "email" | "call"; label: string; n: number; done: boolean; gap: number }[] = [
    { kind: "email", label: "First email",         n: 1, done: sent >= 1,  gap: 0 },
    { kind: "email", label: "Follow-up 1",         n: 2, done: sent >= 2,  gap: FU_BIZDAYS },
    { kind: "call",  label: "First call",          n: 1, done: calls >= 1, gap: CALL_BUFFER },
    { kind: "email", label: "Follow-up 2 (final)", n: 3, done: sent >= 3,  gap: FU_BIZDAYS },
    { kind: "call",  label: "Second call",         n: 2, done: calls >= 2, gap: GAP_AFTER_CALL[0] },
    { kind: "call",  label: "Third call",          n: 3, done: calls >= 3, gap: GAP_AFTER_CALL[1] },
  ];

  // Byron 2026-08-10: "the dates are wrong, it looks like it's using Aug 9 as
  // today." A lead emailed Aug 4 had follow-up 1 dated Aug 7 — a date that had
  // already gone by — and every later step chained off that stale Aug 7. So a
  // PENDING step is never allowed to sit in the past: the soonest it can really
  // happen is today, and the rest of the chain runs from today. This is the same
  // rule as "send late and the plan slides", applied to steps that ran late
  // because nobody got to them.
  const today = startOfToday();

  return plan.map((p) => {
    if (p.done) {
      // Already happened — anchor it at the last known activity rather than
      // projecting a date we can't know per-step.
      return { kind: p.kind, label: p.label, due: cursor, done: true, n: p.n };
    }
    cursor = addBizDays(cursor, p.gap);          // chain forward from real activity
    if (cursor < today) cursor = bumpToBizDay(today);   // overdue -> due today
    return { kind: p.kind, label: p.label, due: new Date(cursor), done: false, n: p.n };
  });
}

export function nextStep(l: Lead): Step | null {
  return schedule(l).find((s) => !s.done) || null;
}

/**
 * What needs doing right now. Single source of truth for the My Day counts, the
 * "Needs action" filter, the row badges and the Leads grouping.
 */
export type Action =
  | { kind: "send"; label: string; level: 0 }
  | { kind: "follow"; label: string; level: 1 | 2 | 3 }
  | { kind: "call"; label: string; level: 0 }
  | null;

export function actionFor(l: Lead): Action {
  const s = norm(l.status);
  if (s === "No" || s === "Replied") return null;
  if (s === "New" || (l.sent_count || 0) === 0) {
    return { kind: "send", label: "Send first email", level: 0 };
  }
  const sent = l.sent_count || 0;
  const calls = l.call_count || 0;
  const sinceEmail = bizDaysSince(l.last_activity);

  // A call is due once follow-up 1 has gone out and the buffer has passed.
  if (sent >= 2 && calls < MAX_CALL_ATTEMPTS) {
    const need = calls === 0 ? CALL_BUFFER : GAP_AFTER_CALL[Math.min(calls - 1, 1)];
    const sinceCall = calls === 0 ? sinceEmail : bizDaysSince(l.last_call_at);
    if (sinceCall >= need) {
      return { kind: "call", label: `Call #${calls + 1}`, level: 0 };
    }
  }
  // Otherwise an email follow-up, once it is due and we are under the touch cap.
  if (sent < EMAIL_TOUCHES && sinceEmail >= FU_BIZDAYS) {
    const n = sent as 1 | 2;
    return { kind: "follow", label: `Follow-up ${n}`, level: (n === 1 ? 1 : 2) };
  }
  return null;
}

/* ------------------------------------------------------------------ timezones */

export function theirTime(l: Lead): string | null {
  if (l.tz_offset == null) return null;
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const d = new Date(utc + l.tz_offset * 3600000);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Their 09:00–17:00 expressed in OUR clock (Bogotá). Never show a raw offset. */
export function windowHere(l: Lead): string | null {
  if (l.tz_offset == null) return null;
  const shift = MY_TZ - l.tz_offset;
  const fmt = (h: number) => {
    const x = ((h + shift) % 24 + 24) % 24;
    return `${String(x).padStart(2, "0")}:00`;
  };
  return `Call ${fmt(9)}–${fmt(17)} your time (COT)`;
}

export type CallWindow = { state: "dnc" | "good" | "outside"; label: string };

export function callWindow(l: Lead): CallWindow {
  if (l.dnc) return { state: "dnc", label: "Do not call" };
  if (l.tz_offset == null) return { state: "outside", label: "Unknown hours" };
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const h = new Date(utc + l.tz_offset * 3600000).getHours();
  return h >= 9 && h < 17
    ? { state: "good", label: "Good to call" }
    : { state: "outside", label: "Outside hours" };
}

export const ZONE_NAME: Record<number, string> = {
  [-5]: "ET", [-6]: "CT", [-7]: "MT", [-8]: "PT",
};

export function zoneChip(l: Lead): string | null {
  return l.tz_offset == null ? null : ZONE_NAME[l.tz_offset] || null;
}

/* ---------------------------------------------------------------- rep colours */

export const REP_COLORS: Record<string, string> = {
  Stephany: "#7A5AE0",
  Nany: "#2A8FDB",
  Byron: "#12866E",
  Dani: "#D9772F",
};
export const REP_FALLBACK = "#8a978f";

export function repColor(name?: string | null): string {
  if (!name) return REP_FALLBACK;
  return REP_COLORS[name] || REP_FALLBACK;
}

/* ---------------------------------------------------------------- LinkedIn */

/**
 * THE LINKEDIN CADENCE (Byron 2026-08-13 — email paused while nearwork.co recovers).
 *
 * Deliberately NOT the email cadence. On LinkedIn you cannot message someone until
 * they accept, so the sequence is gated on their action, not the clock:
 *
 *   day 0            connection request + note
 *   on accept        the real message (this is where the pitch lives)
 *   +4 business days one follow-up message, then stop
 *
 * There is no chasing an unaccepted request — a second request isn't possible, and
 * LinkedIn throttles accounts that behave like bulk senders.
 */
export const LI_FOLLOWUP_BIZDAYS = 4;

export type LinkedInStep = {
  stage: "connect" | "message" | "followup" | "done";
  label: string;
  hint: string;
  due: Date | null;
};

export function linkedinStep(l: Lead): LinkedInStep {
  const at = localDate(l.linkedin_at);
  if (!l.linkedin_stage) {
    return { stage: "connect", label: "Send connection request",
             hint: "Note only — no pitch. The note's job is to earn the accept.",
             due: startOfToday() };
  }
  if (l.linkedin_stage === "connect") {
    return { stage: "message", label: "Send message once they accept",
             hint: "Wait for the accept. You can't message before they connect.",
             due: at };
  }
  // Already messaged — one follow-up, then stop.
  const due = at ? bumpToBizDay(addBizDays(at, LI_FOLLOWUP_BIZDAYS)) : null;
  if (due && due > startOfToday()) {
    return { stage: "followup", label: "Follow-up message", hint: "One nudge, then stop.", due };
  }
  return { stage: "followup", label: "Follow-up message due", hint: "One nudge, then stop.", due };
}
