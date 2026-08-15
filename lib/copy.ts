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
 *
 * NO SCARE-QUOTED CTA (Byron 2026-08-11). This used to end: reply "yes". His reasoning:
 * the quote marks make it read as a template — "people can assume that it's a generated
 * email and that no thought was given". Offer to share profiles instead. Do not
 * reintroduce a quoted keyword CTA here or in outreach_spec.py.
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

  // Follow-ups normally reuse the original subject so the thread stays together. But
  // subjects written before 2026-08-12 carry a price comparison ("$3,600/mo here vs
  // $11,100 in the US"), and a "$" in a subject line is a top-tier spam signal — it is
  // the shape of every discount blast. Threading is worth nothing if the original went
  // to spam and was never seen, so a priced legacy subject is replaced rather than
  // echoed. (Byron 2026-08-12: a test send landed in spam.)
  const legacyPriced = /\$/.test(l.gen_subject || "");
  const subject = legacyPriced
    ? `Following up — ${role}`
    : `Re: ${l.gen_subject || role}`;

  // Touch 2 — follow-up 1.
  if (sent === 1) {
    const body = rate
      ? `Hi ${who},\n\nFloating this up — I've got two ${role} profiles ready to go (Latin America, your hours, from ${rate}/mo). I'd be happy to share them if you're interested.`
      : `Hi ${who},\n\nFloating this back up in case it got buried. If the ${role} search is still open, I'm happy to send over two example profiles from Latin America — no call required, just reply and I'll send them.\n\nAnd if it's not relevant, tell me and I'll close it out — no worries either way.`;
    return { label: "Follow-up 1", subject, body };
  }

  // Touch 3 — the final nudge.
  if (sent === 2) {
    const body = rate
      ? `Hi ${who},\n\nLast nudge on this. If the ${role} search is still open, I'll send two profiles from ${rate}/mo — no call, and we replace anyone who isn't right in the first 3 months. Worth a look? If it's not relevant, just say so and I'll close it out — no worries either way.`
      : `Hi ${who},\n\nLast nudge on this. If the ${role} search is still open, I'll send over two example profiles from Latin America — no call required. Worth a look? If it's not relevant, just say so and I'll close it out — no worries either way.`;
    return { label: "Follow-up 2 (final)", subject, body };
  }

  return { label: "Sequence complete", subject: "", body: "", note: "All three emails have gone out. The call queue carries it from here." };
}

/* ------------------------------------------------------------------ LinkedIn */

/**
 * LINKEDIN OUTREACH — TWO STEPS, NOT ONE.
 *
 * Byron 2026-08-13, with nearwork.co's email in junk: "We'll be sending them a
 * connection using a note. Or is there a better way to do this?" There is.
 *
 * A connection note is capped at ~300 characters, and free LinkedIn accounts ration
 * personalised invitations to a handful a month. Cramming a pitch in there also
 * LOWERS acceptance - it reads as a sales approach before any relationship exists.
 *
 * So the note's only job is to earn the accept. The pitch goes in the message AFTER
 * they accept, where there's no character limit and they've opted in by connecting.
 *
 * Mirrors outreach_spec.linkedin_note / linkedin_message. Change both together.
 */
export function linkedinNote(l: Lead, _openedEmail?: boolean): string {
  const who = firstName(l);
  const r = roleOf(l);
  const intro = `Hi ${who} — I'm Byron from Nearwork. `;
  const what = "We place vetted professionals from Latin America into US teams, on your hours. ";
  const saw = `Saw ${l.company} is hiring for ${r} — I can send a couple of profiles that fit, no commitment. `;
  const close = "If it's not for you, no worries at all — I'd still love to connect. Best of luck!";
  // Byron's own wording (2026-08-13). He did NOT want the note to mention the email
  // that went to spam — "more of a connection and valuable asset."
  //
  // Over 300 chars LinkedIn truncates, and real company/role names push it over. Drop
  // whole clauses in priority order, never mid-sentence. The WARM OUT outlives the
  // description of Nearwork: it is what makes this read as a person rather than a
  // pitch, and they can read what we do on the profile anyway.
  for (const parts of [[intro, what, saw, close], [intro, saw, close],
                       [intro, what, saw], [intro, saw]]) {
    const note = parts.join("").trim();
    if (note.length <= 300) return note;
  }
  return (intro + saw).trim().slice(0, 300);
}

export function linkedinMessage(l: Lead): string {
  const who = firstName(l);
  const r = roleOf(l);
  const rate = quotedRate(l);
  const pitch = rate
    ? `The same level runs about ${rate}/mo from Latin America on your hours.`
    : `We place professionals from Latin America who work your hours, screened against your exact job description before you see them.`;
  return `Thanks for connecting, ${who}.\n\nI noticed ${l.company} is hiring for ${r}. ${pitch}\n\nYou pay only once someone is hired, and if it isn't the right fit in the first few months we replace them.\n\nI'd be happy to share a couple of example profiles if you're interested — no call needed. Worth a look?`;
}

/** LinkedIn search URL for a contact we have no profile URL for. */
export function linkedinSearch(l: Lead): string {
  const q = [l.contact_name?.split("(")[0].trim(), l.company].filter(Boolean).join(" ");
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
}

/**
 * Sales Navigator InMail — sent WITHOUT connecting first.
 * Mirrors outreach_spec.linkedin_inmail. One step instead of two, but Sales Navigator
 * rations InMails (~50/month), so each one carries the whole pitch.
 */
export function linkedinInmail(l: Lead): { subject: string; body: string } {
  const who = firstName(l);
  const r = roleOf(l);
  const rate = quotedRate(l);
  const pitch = rate
    ? `The same level runs about ${rate}/mo from Latin America, working your hours.`
    : `We place professionals from Latin America who work your hours, each one screened against your exact job description before you see them.`;
  return {
    subject: `${r} at ${l.company}`,
    body: `Hi ${who} — I'm Byron from Nearwork.\n\nSaw ${l.company} is hiring for ${r}. ${pitch}\n\nYou pay only once someone is hired, and if it isn't the right fit in the first few months we replace them.\n\nI can send a couple of profiles that fit, no commitment — no call needed. Worth a look?\n\nIf it's not for you, no worries at all — I'd still love to connect. Best of luck!`,
  };
}
