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
};

type Sprint = {
  id: number; name: string; focus: string | null; start_date: string;
  subject_tpl: string | null; body_tpl: string | null;
  leads: number; sent: number; replied: number; reply_rate: number;
};

const base = (s: string) => (s || "").split(" (")[0];
const STATUSES = ["All", "New", "Sent", "Replied", "No"];

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
  const [status, setStatus] = useState("All");
  const [query, setQuery] = useState("");
  const [openMsg, setOpenMsg] = useState<number | null>(null);
  const [copied, setCopied] = useState<string>("");

  async function load() {
    setLoading(true);
    const [lr, sr] = await Promise.all([
      fetch("/api/leads", { cache: "no-store" }),
      fetch("/api/sprints", { cache: "no-store" }),
    ]);
    setLeads(lr.ok ? await lr.json() : []);
    setSprints(sr.ok ? await sr.json() : []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function patch(id: number, body: Record<string, any>) {
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, ...body } : l))); // optimistic
    await fetch(`/api/leads/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const markNo = (l: Lead) => patch(l.id, { status: l.status === "No" ? "New" : "No" });

  async function copy(text: string, tag: string) {
    try { await navigator.clipboard.writeText(text); setCopied(tag); setTimeout(() => setCopied(""), 1400); }
    catch { /* clipboard blocked */ }
  }

  const owners = useMemo(() => ["All", ...Array.from(new Set(leads.map((l) => l.owner || "—")))], [leads]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { New: 0, Sent: 0, Replied: 0 };
    leads.forEach((l) => { if (l.status !== "No") { const b = base(l.status); if (b === "Replied" || b === "Deal" || b === "Won") c.Replied++; else c[b] = (c[b] || 0) + 1; } });
    return c;
  }, [leads]);
  const bestRate = useMemo(() => Math.max(0, ...sprints.map((s) => s.reply_rate)), [sprints]);

  const rows = leads.filter((l) =>
    (owner === "All" || (l.owner || "—") === owner) &&
    (status === "All" || base(l.status) === status) &&
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
          <div className="asof">{leads.filter((l) => l.status !== "No").length} active companies</div>
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
        <div className="card"><div className="n">{leads.filter((l) => l.status !== "No").length}</div><div className="l">Total</div></div>
        <div className="card"><div className="n">{counts.New || 0}</div><div className="l">New</div></div>
        <div className="card"><div className="n">{counts.Sent || 0}</div><div className="l">Sent</div></div>
        <div className="card"><div className="n">{counts.Replied || 0}</div><div className="l">Replied</div></div>
      </div>

      <div className="controls">
        <div className="chips">
          {owners.map((o) => (
            <div key={o} className={`chip ${o === owner ? "on" : ""}`} onClick={() => setOwner(o)}>
              {o}{o === "All" ? "" : ` · ${leads.filter((l) => (l.owner || "—") === o).length}`}
            </div>
          ))}
        </div>
        <div className="chips">
          {STATUSES.map((s) => (
            <div key={s} className={`chip ${s === status ? "on" : ""}`} onClick={() => setStatus(s)}>{s}</div>
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
              <th>Company</th><th>Owner</th><th>Role</th><th>Stage</th><th>Sprint</th><th>Email</th><th>Last</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((l) => {
                const subject = render(l.subject_tpl, l);
                const body = render(l.body_tpl, l);
                const hasMsg = !!(l.subject_tpl || l.body_tpl);
                const isOpen = openMsg === l.id;
                return (
                  <Fragment key={l.id}>
                    <tr className={l.status === "No" ? "no" : ""}>
                      <td className="co">{l.company}</td>
                      <td>{l.owner || "—"}</td>
                      <td className="muted">{l.role || "—"}</td>
                      <td>
                        <span className={`badge b-${base(l.status)}`}>{l.status}{l.sent_count > 0 && base(l.status) === "Sent" ? ` (touch ${l.sent_count})` : ""}</span>
                        {l.opened && (
                          <span title={`Genuinely opened${l.opened_at ? ` on ${(l.opened_at || "").slice(0, 10)}` : ""} — rep prep-opens are filtered out`}
                            style={{ marginLeft: 6, fontSize: 11, color: "#0a7", whiteSpace: "nowrap" }}>
                            👁 Opened{l.opened_at ? ` ${(l.opened_at || "").slice(5, 10)}` : ""}
                          </span>
                        )}
                      </td>
                      <td>{l.sprint_name ? <span className="badge" style={{ background: "#2a2f3a", color: "#cdd5e3" }}>{l.sprint_name}</span> : <span className="muted">—</span>}</td>
                      <td>{l.email ? (<>{l.email}<div className="muted">{l.email_confidence}</div></>) : <span className="muted">—</span>}</td>
                      <td className="muted">{(l.last_activity || "").slice(0, 10)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {hasMsg && <button className="act" onClick={() => setOpenMsg(isOpen ? null : l.id)} style={{ marginRight: 6 }}>{isOpen ? "Hide" : "✉ Message"}</button>}
                        <button className="act" onClick={() => markNo(l)}>{l.status === "No" ? "Undo" : "Mark No"}</button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={8} style={{ background: "#0f131a", padding: 16 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                            <b style={{ fontSize: 12, color: "#9aa4b6" }}>SUBJECT</b>
                            <button className="act" onClick={() => copy(subject, `s${l.id}`)}>{copied === `s${l.id}` ? "Copied ✓" : "Copy"}</button>
                          </div>
                          <div style={{ fontSize: 14, marginBottom: 14 }}>{subject || <span className="muted">—</span>}</div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                            <b style={{ fontSize: 12, color: "#9aa4b6" }}>MESSAGE</b>
                            <button className="act" onClick={() => copy(body, `b${l.id}`)}>{copied === `b${l.id}` ? "Copied ✓" : "Copy"}</button>
                            <button className="act" onClick={() => copy(`${subject}\n\n${body}`, `a${l.id}`)}>{copied === `a${l.id}` ? "Copied ✓" : "Copy all"}</button>
                          </div>
                          <div style={{ fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{body || <span className="muted">This Sprint has no message template yet.</span>}</div>
                          {l.sprint_name && <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>From {l.sprint_name}. Personalize the opening line if you have a specific detail.</div>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8} className="center">No matching leads.</td></tr>}
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
