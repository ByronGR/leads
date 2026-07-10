"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useSession, signOut } from "next-auth/react";

type Lead = {
  id: number; company: string; owner: string | null; role: string | null;
  email: string | null; email_confidence: string | null; status: string;
  sent_count: number; ab_variant: string; why_now: string | null;
  job_url: string | null; last_activity: string | null;
  opened?: boolean; opened_at?: string | null;
  first_name?: string | null; contact_name?: string | null; lead_date?: string | null;
  sprint_name?: string | null; subject_tpl?: string | null; body_tpl?: string | null;
  steps?: { subject?: string; body?: string }[] | null;
};

type Sprint = {
  id: number; name: string; focus: string | null; start_date: string;
  subject_tpl: string | null; body_tpl: string | null;
  leads: number; sent: number; replied: number; reply_rate: number;
};

const base = (s: string) => (s || "").split(" (")[0];
const NEEDS = "Needs action";
const STATUSES = [NEEDS, "All", "New", "Sent", "Replied", "No"];

function daysSince(d?: string | null) {
  if (!d) return 999;
  const t = new Date((d || "").slice(0, 10)).getTime();
  return isNaN(t) ? 999 : Math.floor((Date.now() - t) / 86400000);
}

// What (if anything) the rep needs to do next for this lead.
function actionFor(l: Lead): { label: string; kind: "send" | "follow" } | null {
  if (l.status === "No") return null;
  const b = base(l.status);
  if (b === "New") return { label: "Send first email", kind: "send" };
  if (b === "Sent" && daysSince(l.last_activity) >= 4) return { label: `Follow-up ${l.sent_count || 1}`, kind: "follow" };
  return null;
}

// The message the rep should send NEXT, based on how many emails HubSpot says
// already went out (sent_count). steps[0] = first email, steps[1] = follow-up 1, …
function messageFor(l: Lead): { label: string; subject: string; body: string; note?: string } {
  const b = base(l.status);
  if (b === "Replied" || b === "Deal" || b === "Won") {
    return { label: "Replied", subject: "", body: "", note: "This lead replied — continue the conversation in your inbox." };
  }
  const steps = (l.steps && l.steps.length)
    ? l.steps
    : [{ subject: l.subject_tpl || "", body: l.body_tpl || "" }];
  const idx = l.sent_count || 0;
  if (idx >= steps.length) {
    return { label: "Sequence complete", subject: "", body: "", note: "You've sent every message in this Sprint's sequence — no further follow-up is defined." };
  }
  const step = steps[idx];
  const label = idx === 0 ? "First email" : `Follow-up ${idx}`;
  return { label, subject: render(step.subject, l), body: render(step.body, l) };
}

// Fill a sprint template ({first_name}, {company}, {role}, {contact_name}, {sender}).
function render(tpl: string | null | undefined, l: Lead): string {
  const map: Record<string, string> = {
    first_name: l.first_name || "there",
    company: l.company || "",
    role: (l.role || "the role").toString(),
    contact_name: l.contact_name || l.first_name || "",
    sender: base(l.owner || "") || "the Nearwork team",
  };
  return (tpl || "").replace(/\{(\w+)\}/g, (_m, k) => (k in map ? map[k] : `{${k}}`));
}

export default function LeadsClient() {
  const { data: session } = useSession();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [owner, setOwner] = useState("All");
  const [status, setStatus] = useState(NEEDS);
  const [query, setQuery] = useState("");
  const [openMsg, setOpenMsg] = useState<number | null>(null);
  const [copied, setCopied] = useState<string>("");
  const [ownerTouched, setOwnerTouched] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number>(0);

  // Map the signed-in @nearwork.co user to their owner name so a rep lands on
  // their OWN action list. (Byron/admins can click "All" to see everyone.)
  const REP_BY_EMAIL: Record<string, string> = {
    "byron.giraldo@nearwork.co": "Byron",
    "stephany.picos@nearwork.co": "Stephany",
    "nany.guerra@nearwork.co": "Nany",
    "daniela.jessurum@nearwork.co": "Dani",
  };

  async function load(silent = false) {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const [lr, sr] = await Promise.all([
        fetch("/api/leads", { cache: "no-store" }),
        fetch("/api/sprints", { cache: "no-store" }),
      ]);
      setLeads(lr.ok ? await lr.json() : []);
      setSprints(sr.ok ? await sr.json() : []);
      setUpdatedAt(Date.now());
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }
  useEffect(() => { load(); }, []);
  // Auto-refresh from the database every 60s so team changes appear without a reload.
  useEffect(() => {
    const id = setInterval(() => load(true), 60000);
    return () => clearInterval(id);
  }, []);

  // Remember the last owner filter this person chose (so admins can pin "All").
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("nw_owner") : null;
    if (saved) { setOwner(saved); setOwnerTouched(true); }
  }, []);

  // Otherwise, on first load focus the signed-in rep's own leads.
  useEffect(() => {
    if (ownerTouched || !leads.length) return;
    const me = REP_BY_EMAIL[(session?.user?.email || "").toLowerCase()];
    if (me && leads.some((l) => (l.owner || "") === me)) setOwner(me);
  }, [session, leads, ownerTouched]);

  const pickOwner = (o: string) => {
    setOwner(o); setOwnerTouched(true);
    if (typeof window !== "undefined") localStorage.setItem("nw_owner", o);
  };

  async function patch(id: number, body: Record<string, any>) {
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, ...body } : l))); // optimistic
    await fetch(`/api/leads/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const todayISO = () => new Date().toISOString().slice(0, 10);
  function doAction(l: Lead, action: string) {
    if (action === "messaged") {
      patch(l.id, { status: "Sent", sent_count: (l.sent_count || 0) + 1, last_activity: todayISO() });
    } else if (action === "messaged_date") {
      const d = window.prompt("What date did you message them? (YYYY-MM-DD)", todayISO());
      if (!d) return;
      if (/^\d{4}-\d{2}-\d{2}$/.test(d.trim())) patch(l.id, { status: "Sent", sent_count: (l.sent_count || 0) + 1, last_activity: d.trim() });
      else window.alert("Please use the format YYYY-MM-DD, e.g. 2026-07-09");
    } else if (action === "replied") {
      patch(l.id, { status: "Replied" });
    } else if (action === "not_interested") {
      patch(l.id, { status: "No" });
    } else if (action === "reset") {
      patch(l.id, { status: "New", sent_count: 0, reset: true });
    }
  }

  async function copy(text: string, tag: string) {
    try { await navigator.clipboard.writeText(text); setCopied(tag); setTimeout(() => setCopied(""), 1400); }
    catch { /* clipboard blocked */ }
  }

  const matchStatus = (l: Lead) =>
    status === "All" ? true : status === NEEDS ? actionFor(l) !== null : base(l.status) === status;

  const owners = useMemo(() => ["All", ...Array.from(new Set(leads.map((l) => l.owner || "—")))], [leads]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { needs: 0, New: 0, Sent: 0, Replied: 0 };
    leads.forEach((l) => {
      if (l.status === "No") return;
      if (actionFor(l)) c.needs++;
      const b = base(l.status);
      if (b === "Replied" || b === "Deal" || b === "Won") c.Replied++;
      else c[b] = (c[b] || 0) + 1;
    });
    return c;
  }, [leads]);
  // Per-owner count that reflects the CURRENT status filter (so in "Needs action"
  // mode each rep's chip shows how many they must act on).
  const ownerCount = (o: string) => leads.filter((l) => (l.owner || "—") === o && matchStatus(l)).length;
  const bestRate = useMemo(() => Math.max(0, ...sprints.map((s) => s.reply_rate)), [sprints]);

  const rows = leads.filter((l) =>
    (owner === "All" || (l.owner || "—") === owner) &&
    matchStatus(l) &&
    (query === "" || l.company.toLowerCase().includes(query.toLowerCase()))
  );

  return (
    <div className="wrap">
      <div className="top">
        <div>
          <div className="brand">Nearwork · Leads</div>
          <div className="sub">leads.nearwork.co — live pipeline. Changes save instantly for the whole team.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className="act"
              onClick={() => load(true)}
              disabled={refreshing}
              title="Reload the latest data (team updates + the most recent HubSpot sync)"
              style={{ fontWeight: 700 }}
            >
              {refreshing ? "Refreshing…" : "↻ Refresh"}
            </button>
            {updatedAt > 0 && (
              <span className="muted" title="When this page last loaded data from the database">
                Updated {new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
          {session?.user?.email && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span className="muted">{session.user.email}</span>
              <button className="act" onClick={() => signOut({ callbackUrl: "/signin" })} title="Sign out">Sign out</button>
            </div>
          )}
        </div>
      </div>

      {/* Sprint performance */}
      {sprints.length > 0 && (
        <div style={{ margin: "6px 0 18px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#9aa4b6", margin: "0 0 8px" }}>Sprint performance (A/B)</div>
          <div className="scroll">
            <table>
              <thead><tr>
                <th>Sprint</th><th>Since</th><th>Focus</th><th>Leads</th><th>Sent</th><th>Replied</th><th>Reply rate</th>
              </tr></thead>
              <tbody>
                {sprints.map((s) => (
                  <tr key={s.id}>
                    <td className="co">{s.name}</td>
                    <td className="muted">{(s.start_date || "").slice(0, 10)}</td>
                    <td className="muted" style={{ maxWidth: 320, whiteSpace: "normal" }}>{s.focus || "—"}</td>
                    <td>{s.leads}</td>
                    <td>{s.sent}</td>
                    <td>{s.replied}</td>
                    <td>
                      <span style={{
                        fontWeight: 700,
                        color: s.reply_rate > 0 && s.reply_rate === bestRate ? "#12b886" : undefined,
                      }}>{s.reply_rate}%</span>
                      {s.reply_rate > 0 && s.reply_rate === bestRate && <span style={{ marginLeft: 6, fontSize: 11 }}>▲ best</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="cards">
        <div className="card" style={{ borderColor: "var(--teal2)" }}>
          <div className="n" style={{ color: "var(--teal)" }}>{counts.needs || 0}</div>
          <div className="l">Needs action</div>
        </div>
        <div className="card"><div className="n">{leads.filter((l) => l.status !== "No").length}</div><div className="l">Total</div></div>
        <div className="card"><div className="n">{counts.New || 0}</div><div className="l">New</div></div>
        <div className="card"><div className="n">{counts.Sent || 0}</div><div className="l">Sent</div></div>
        <div className="card"><div className="n">{counts.Replied || 0}</div><div className="l">Replied</div></div>
      </div>

      <div className="controls">
        <div className="chips">
          {owners.map((o) => (
            <div key={o} className={`chip ${o === owner ? "on" : ""}`} onClick={() => pickOwner(o)}>
              {o}{o === "All" ? "" : ` · ${ownerCount(o)}`}
            </div>
          ))}
        </div>
        <div className="chips">
          {STATUSES.map((s) => (
            <div key={s} className={`chip ${s === status ? "on" : ""}`} onClick={() => setStatus(s)}>
              {s === "No" ? "Not interested" : s}{s === NEEDS ? ` · ${owner === "All" ? counts.needs : ownerCount(owner)}` : ""}
            </div>
          ))}
        </div>
        <input className="search" placeholder="Search company…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {loading ? (
        <div className="center">Loading…</div>
      ) : (
        <div className="scroll">
          <table>
            <thead><tr>
              <th>Company</th><th>Owner</th><th>Role</th><th>To do</th><th>Stage</th><th>Sprint</th><th>Email</th><th>Last</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((l) => {
                const msg = messageFor(l);
                const hasMsg = !!(l.subject_tpl || l.body_tpl || (l.steps && l.steps.length));
                const isOpen = openMsg === l.id;
                return (
                  <Fragment key={l.id}>
                    <tr className={l.status === "No" ? "no" : ""}>
                      <td className="co">{l.company}</td>
                      <td>{l.owner || "—"}</td>
                      <td className="muted">{l.role || "—"}</td>
                      <td>
                        {(() => {
                          const a = actionFor(l);
                          return a ? (
                            <span className="badge" style={{
                              background: a.kind === "send" ? "var(--grn)" : "var(--ylw)",
                              color: a.kind === "send" ? "var(--grntx)" : "var(--ylwtx)",
                            }}>{a.label}</span>
                          ) : <span className="muted">—</span>;
                        })()}
                      </td>
                      <td>
                        <span className={`badge b-${base(l.status)}`}>{l.status}{l.sent_count > 0 && base(l.status) === "Sent" ? ` (touch ${l.sent_count})` : ""}</span>
                        {l.opened && (
                          <span title={`Genuinely opened${l.opened_at ? ` on ${(l.opened_at || "").slice(0, 10)}` : ""} — rep prep-opens are filtered out`}
                            style={{ marginLeft: 6, fontSize: 11, color: "#0a7", whiteSpace: "nowrap" }}>
                            👁 Opened{l.opened_at ? ` ${(l.opened_at || "").slice(5, 10)}` : ""}
                          </span>
                        )}
                      </td>
                      <td>{l.sprint_name ? <span className="badge" style={{ background: "var(--card)", color: "var(--tx)", border: "1px solid var(--line)" }}>{l.sprint_name}</span> : <span className="muted">—</span>}</td>
                      <td>{l.email ? (<>{l.email}<div className="muted">{l.email_confidence}</div></>) : <span className="muted">—</span>}</td>
                      <td className="muted">{(l.last_activity || "").slice(0, 10)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {hasMsg && <button className="act" onClick={() => setOpenMsg(isOpen ? null : l.id)} style={{ marginRight: 6 }}>{isOpen ? "Hide" : "✉ Message"}</button>}
                        <select
                          className="act"
                          value=""
                          onChange={(e) => doAction(l, e.target.value)}
                          style={{ cursor: "pointer" }}
                          title="Update this lead"
                        >
                          <option value="" disabled>Update ▾</option>
                          <option value="messaged">✓ Messaged today</option>
                          <option value="messaged_date">✓ Messaged on a date…</option>
                          <option value="replied">💬 Mark replied</option>
                          <option value="not_interested">🚫 Not interested</option>
                          <option value="reset">↺ Reset to New</option>
                        </select>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={9} style={{ background: "var(--card)", padding: 16, borderBottom: "2px solid var(--teal2)" }}>
                          <div style={{ marginBottom: 12 }}>
                            <span className="badge" style={{ background: "var(--teal)", color: "#fff" }}>Next: {msg.label}</span>
                            {l.sprint_name && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{l.sprint_name} · {l.sent_count || 0} email{(l.sent_count || 0) === 1 ? "" : "s"} sent so far</span>}
                          </div>
                          {msg.note ? (
                            <div style={{ fontSize: 14, color: "var(--tx)" }}>{msg.note}</div>
                          ) : (
                            <>
                              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                                <b style={{ fontSize: 12, color: "var(--mut)", letterSpacing: ".04em" }}>SUBJECT</b>
                                <button className="act" onClick={() => copy(msg.subject, `s${l.id}`)}>{copied === `s${l.id}` ? "Copied ✓" : "Copy"}</button>
                              </div>
                              <div style={{ fontSize: 14, marginBottom: 14, color: "var(--tx)" }}>{msg.subject || <span className="muted">—</span>}</div>
                              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                                <b style={{ fontSize: 12, color: "var(--mut)", letterSpacing: ".04em" }}>MESSAGE</b>
                                <button className="act" onClick={() => copy(msg.body, `b${l.id}`)}>{copied === `b${l.id}` ? "Copied ✓" : "Copy"}</button>
                                <button className="act" onClick={() => copy(`${msg.subject}\n\n${msg.body}`, `a${l.id}`)}>{copied === `a${l.id}` ? "Copied ✓" : "Copy all"}</button>
                              </div>
                              <div style={{ fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.5, color: "var(--tx)" }}>{msg.body || <span className="muted">This Sprint has no message for this step yet.</span>}</div>
                              <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>Personalize the opening line if you have a specific detail.</div>
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={9} className="center">{status === NEEDS ? "🎉 Nothing needs action here — you're all caught up." : "No matching leads."}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <p className="note">
        Live app — edits save to the database and reflect for the whole team. The daily routine adds new leads nightly
        (the only place AI is used); it never overwrites your changes. Sprints are set with Claude — tell it when a new
        Sprint starts and what it's testing.
      </p>
    </div>
  );
}
