import { Lead, nextStep } from "./cadence";

/**
 * PER-TOUCH EMAIL COPY.
 *
 * Byron 2026-08-09: "the follow-up stage doesn't have the correct email."
 *
 * The pipeline writes ONE body per lead (gen_subject/gen_body) and it is always
 * the FIRST TOUCH. The old page relabelled that same text "Follow-up 1" and
 * showed it anyway — so a follow-up went out reading like a cold intro. This
 * generates the right message for whichever touch is actually next.
 *
 * The wording mirrors outreach_spec.py exactly (Variant C + the warm bump).
 * If those templates change in Python, change them here too.
 */

/** Pull the quoted rate out of the stored first-touch copy so follow-ups reuse
 *  the SAME number. Avoids duplicating Salary.xlsx in the front end — if the
 *  first email quoted $5,600/mo, every follow-up quotes $5,600/mo. */
export function quotedRate(l: Lead): string | null {
  const hay = `${l.gen_subject || ""} ${l.gen_body || ""}`;
  const m = hay.match(/\$\s?([\d,]+)\s*\/\s*mo/i) || hay.match(/\bat\s([\d,]+)\s*\/\s*month/i);
  return m ? `$${m[1].replace(/\s/g, "")}` : null;
}

function firstName(l: Lead): string {
  const raw = (l.contact_name || "").split("(")[0].trim();
  const f = raw.split(/\s+/)[0];
  return f && !/\d/.test(f) ? f : "there";
}

function roleOf(l: Lead): string {
  return (l.role || "the role").trim();
}

export type Message = { label: string; subject: string; body: string; note?: string };

/**
 * The message to send RIGHT NOW.
 *  - touch 1  -> the pipeline's stored first-touch copy (already priced)
 *  - touch 2  -> Variant C follow-up 1, or the warm bump when unpriced
 *  - touch 3  -> Variant C follow-up 2 (final), or the warm bump
 * Follow-ups are replies on the original thread, so the subject is "Re: …".
 */
export function messageFor(l: Lead): Message {
  const s = String(l.status || "");
  if (["Replied", "Deal", "Won"].includes(s)) {
    return { label: "Replied", subject: "", body: "", note: "This lead replied — continue the conversation in your inbox." };
  }
  if (s === "No") {
    return { label: "Not interested", subject: "", body: "", note: "Marked not interested — no further outreach." };
  }

  const sent = l.sent_count || 0;
  const who = firstName(l);
  const role = roleOf(l);
  const rate = quotedRate(l);

  // Touch 1 — the copy the routine already wrote for this lead.
  if (sent === 0) {
    if (!l.gen_body) {
      return { label: "First email", subject: "", body: "", note: "No copy generated yet — the daily routine writes it overnight." };
    }
    return { label: "First email", subject: l.gen_subject || "", body: l.gen_body };
  }

  const subject = `Re: ${l.gen_subject || role}`;

  // Touch 2 — follow-up 1.
  if (sent === 1) {
    const body = rate
      ? `Hi ${who},\n\nFloating this up — I've got two ${role} profiles ready to go (Latin America, your hours, from ${rate}/mo). Want them? Just reply "yes" and they're in your inbox today.`
      : `Hi ${who},\n\nFloating this back up in case it got buried. If the ${role} search is still open, I'm happy to send over two example profiles from Latin America — no call required, just reply and I'll send them.\n\nAnd if it's not relevant, tell me and I'll close it out — no worries either way.`;
    return { label: "Follow-up 1", subject, body };
  }

  // Touch 3 — the final nudge.
  if (sent === 2) {
    const body = rate
      ? `Hi ${who},\n\nLast nudge on this. If the ${role} search is still open, I'll send two profiles from ${rate}/mo — no call, free replacement in the first 3 months. Worth a look? If it's not relevant, just say so and I'll close it out — no worries either way.`
      : `Hi ${who},\n\nLast nudge on this. If the ${role} search is still open, I'll send over two example profiles from Latin America — no call required. Worth a look? If it's not relevant, just say so and I'll close it out — no worries either way.`;
    return { label: "Follow-up 2 (final)", subject, body };
  }

  return { label: "Sequence complete", subject: "", body: "", note: "All three emails have gone out. The call queue carries it from here." };
}
