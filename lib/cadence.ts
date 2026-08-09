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

// What one person actually sends in a day, mirroring daily_send_plan.py.
// Without this the "Emails due" tile counted every technically-due lead (98) —
// true, but not a day's work, and not what Byron would send. (Byron 2026-08-09)
export const DAILY_SEND_CAP = 55;   // daily_send_plan.DAILY_SEND_CAP
export const FU_DAILY = 30;         // daily_send_plan.FU_DAILY

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
  if (iso instanceof Date) return iso;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
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
  const anchor = l.started || l.last_activity;
  const base = localDate(anchor) || new Date();
  const sent = l.sent_count || 0;
  const calls = l.call_count || 0;

  const fu1 = addBizDays(base, FU_BIZDAYS);
  const fu2 = addBizDays(fu1, FU_BIZDAYS);
  const call1 = addBizDays(fu1, CALL_BUFFER);
  const call2 = addBizDays(call1, GAP_AFTER_CALL[0]);
  const call3 = addBizDays(call2, GAP_AFTER_CALL[1]);

  return [
    { kind: "email", label: "First email", due: base, done: sent >= 1, n: 1 },
    { kind: "email", label: "Follow-up 1", due: fu1, done: sent >= 2, n: 2 },
    { kind: "call", label: "First call", due: call1, done: calls >= 1, n: 1 },
    { kind: "email", label: "Follow-up 2 (final)", due: fu2, done: sent >= 3, n: 3 },
    { kind: "call", label: "Second call", due: call2, done: calls >= 2, n: 2 },
    { kind: "call", label: "Third call", due: call3, done: calls >= 3, n: 3 },
  ];
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
