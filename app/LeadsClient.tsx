"use client";
import { useEffect, useMemo, useState } from "react";
import { useSession, signOut } from "next-auth/react";

type Lead = {
  id: number; company: string; owner: string | null; role: string | null;
  email: string | null; email_confidence: string | null; status: string;
  sent_count: number; ab_variant: string; why_now: string | null;
  job_url: string | null; last_activity: string | null;
  opened?: boolean; opened_at?: string | null;
};

const base = (s: string) => (s || "").split(" (")[0];
const STATUSES = ["All", "New", "Sent", "Replied", "No"];

export default function LeadsClient() {
  const { data: session } = useSession();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [owner, setOwner] = useState("All");
  const [status, setStatus] = useState("All");
  const [query, setQuery] = useState("");

  async function load() {
    setLoading(true);
    const r = await fetch("/api/leads", { cache: "no-store" });
    setLeads(r.ok ? await r.json() : []);
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
  const setAB = (l: Lead, v: string) => patch(l.id, { ab_variant: v });

  const owners = useMemo(() => ["All", ...Array.from(new Set(leads.map((l) => l.owner || "—")))], [leads]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { New: 0, Sent: 0, Replied: 0 };
    leads.forEach((l) => { if (l.status !== "No") { const b = base(l.status); if (b === "Replied" || b === "Deal" || b === "Won") c.Replied++; else c[b] = (c[b] || 0) + 1; } });
    return c;
  }, [leads]);

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
              <button
                className="act"
                onClick={() => signOut({ callbackUrl: "/signin" })}
                title="Sign out"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>

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
              <th>Company</th><th>Owner</th><th>Role</th><th>Status</th><th>Email</th>
              <th>Approach (A/B)</th><th>Last</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className={l.status === "No" ? "no" : ""}>
                  <td className="co">{l.company}</td>
                  <td>{l.owner || "—"}</td>
                  <td className="muted">{l.role || "—"}</td>
                  <td>
                    <span className={`badge b-${base(l.status)}`}>{l.status}{l.sent_count > 0 && base(l.status) === "Sent" ? ` (touch ${l.sent_count})` : ""}</span>
                    {l.opened && (
                      <span
                        title={`Genuinely opened${l.opened_at ? ` on ${(l.opened_at || "").slice(0, 10)}` : ""} — rep prep-opens are filtered out`}
                        style={{ marginLeft: 6, fontSize: 11, color: "#0a7", whiteSpace: "nowrap" }}
                      >
                        👁 Opened{l.opened_at ? ` ${(l.opened_at || "").slice(5, 10)}` : ""}
                      </span>
                    )}
                  </td>
                  <td>{l.email ? (<>{l.email}<div className="muted">{l.email_confidence}</div></>) : <span className="muted">—</span>}</td>
                  <td><span className="ab">
                    <button className={l.ab_variant === "A" ? "on" : ""} onClick={() => setAB(l, "A")}>A</button>
                    <button className={l.ab_variant === "B" ? "on" : ""} onClick={() => setAB(l, "B")}>B</button>
                  </span></td>
                  <td className="muted">{(l.last_activity || "").slice(0, 10)}</td>
                  <td><button className="act" onClick={() => markNo(l)}>{l.status === "No" ? "Undo" : "Mark No"}</button></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="center">No matching leads.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <p className="note">
        Live app — edits save to the database and reflect for the whole team. The daily routine adds new leads nightly
        (the only place AI is used); it never overwrites your changes. Add Google sign-in (see README) before sharing publicly.
      </p>
    </div>
  );
}
