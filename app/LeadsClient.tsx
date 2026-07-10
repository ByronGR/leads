"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";

/* ---------------- types ---------------- */
type Lead = {
  id: number; company: string; owner: string | null; role: string | null;
  email: string | null; email_confidence: string | null; status: string;
  sent_count: number; why_now: string | null; job_url: string | null;
  last_activity: string | null; opened?: boolean; opened_at?: string | null;
  first_name?: string | null; contact_name?: string | null; lead_date?: string | null;
  sprint_name?: string | null; subject_tpl?: string | null; body_tpl?: string | null;
  steps?: { subject?: string; body?: string }[] | null;
  gen_subject?: string | null; gen_body?: string | null;
};
type Sprint = {
  id: number; name: string; focus: string | null; start_date: string;
  leads: number; sent: number; replied: number; reply_rate: number;
};

/* ---------------- domain logic ---------------- */
const OWNER_COLORS: Record<string, string> = { Stephany: "#7A5AE0", Nany: "#2A8FDB", Byron: "#12866E", Dani: "#D9772F" };
const ownerColor = (o?: string | null) => OWNER_COLORS[o || ""] || "#8a978f";
const initials = (s?: string | null) => (s || "?").trim().slice(0, 1).toUpperCase();
const norm = (s: string) => (s === "Deal" || s === "Won" ? "Replied" : s);
const todayISO = () => new Date().toISOString().slice(0, 10);

function daysSince(d?: string | null) {
  if (!d) return 999;
  const t = new Date(String(d).slice(0, 10)).getTime();
  return isNaN(t) ? 999 : Math.floor((Date.now() - t) / 86400000);
}
function actionFor(l: Lead): { label: string; kind: "send" | "follow" } | null {
  if (l.status === "No") return null;
  if (l.status === "New") return { label: "Send first email", kind: "send" };
  if (l.status === "Sent" && daysSince(l.last_activity) >= 4) return { label: `Follow-up ${l.sent_count || 1}`, kind: "follow" };
  return null;
}
const isDue = (l: Lead) => actionFor(l) !== null;
function followLevel(l: Lead) {
  const a = actionFor(l);
  if (!a || a.kind !== "follow") return 0;
  const n = parseInt(String(a.label).replace(/\D/g, ""), 10) || 1;
  return Math.min(3, Math.max(1, n));
}
function render(tpl: string | null | undefined, l: Lead) {
  const map: Record<string, string> = {
    first_name: l.first_name || "there",
    company: l.company || "",
    role: (l.role || "the role").toString(),
    contact_name: l.contact_name || l.first_name || "",
    sender: (l.owner || "the Nearwork team"),
  };
  return (tpl || "").replace(/\{(\w+)\}/g, (_m, k) => (k in map ? map[k] : `{${k}}`));
}
// Strip the trailing sign-off (salutation + name + Nearwork) so the copied message
// doesn't duplicate the rep's own Outlook signature.
function stripSignature(body: string): string {
  if (!body) return body;
  // Cut from the closing salutation line (a blank line, then "Best regards,"/"Best,"/
  // "Wishing you…," etc.) through the name + "Nearwork". Anchored on real closings so
  // it won't clip body text like "Best of all, …".
  return body
    .replace(/\n\s*\n[ \t]*(?:best regards|best|thanks|thank you|cheers|warm regards|regards|sincerely|talk soon|wishing you[^\n]*)[,.!]?[ \t]*\n[\s\S]*$/i, "")
    .trimEnd();
}
function messageFor(l: Lead): { label: string; subject?: string; body?: string; note?: string } {
  if (["Replied", "Deal", "Won"].includes(l.status)) return { label: "Replied", note: "This lead replied — continue the conversation in your inbox." };
  if (l.status === "No") return { label: "Not interested", note: "Marked not interested — no further outreach." };
  const idx = l.sent_count || 0;
  // First touch: show the routine's PERSONALIZED email (what the rep actually sends),
  // but ONLY when it has a body — otherwise fall back to the full Sprint template so
  // the message is never blank.
  if (idx === 0 && l.gen_body) {
    return { label: "First email", subject: l.gen_subject || render(l.subject_tpl, l), body: stripSignature(l.gen_body) };
  }
  const steps = (l.steps && l.steps.length) ? l.steps : [{ subject: l.subject_tpl || "", body: l.body_tpl || "" }];
  if (idx >= steps.length) return { label: "Sequence complete", note: "Every message in this Sprint's sequence has been sent." };
  const step = steps[idx];
  return { label: idx === 0 ? "First email" : `Follow-up ${idx}`, subject: render(step.subject, l), body: stripSignature(render(step.body, l)) };
}

/* ---------------- atoms ---------------- */
function OwnerDot({ name }: { name?: string | null }) {
  return <span className="owner-dot" style={{ background: ownerColor(name) }}>{initials(name)}</span>;
}
function StageBadge({ l }: { l: Lead }) {
  const s = norm(l.status);
  const txt = l.status === "No" ? "Not interested" : (s === "Sent" && l.sent_count > 0 ? `Sent · touch ${l.sent_count}` : s);
  return <span className={"badge b-" + s}>{txt}</span>;
}
function TodoBadge({ l }: { l: Lead }) {
  const a = actionFor(l);
  if (!a) return <span style={{ color: "var(--tx-3)", fontSize: 13 }}>—</span>;
  const cls = a.kind === "send" ? "send" : "follow f" + followLevel(l);
  return <span className={"badge " + cls}>{a.kind === "send" ? "✎ " : "↩ "}{a.label}</span>;
}
function Icon({ d }: { d: React.ReactNode }) {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;
}
const MailIcon = <Icon d={<><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 7 10 6 10-6" /></>} />;
const DotsIcon = <Icon d={<><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>} />;

type Act = (l: Lead, action: string) => void;

function StatusMenu({ l, onAction }: { l: Lead; onAction: Act }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const act = (a: string) => { setOpen(false); onAction(l, a); };
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="iconbtn" title="Update lead" onClick={() => setOpen((v) => !v)}>{DotsIcon}</button>
      {open && (
        <div className="menu">
          <button onClick={() => act("messaged")}>✓ Mark messaged today</button>
          <button onClick={() => act("messaged_date")}>✓ Messaged on a date…</button>
          <button onClick={() => act("replied")}>💬 Mark replied</button>
          <div className="sep" />
          <button onClick={() => act("not_interested")}>🚫 Not interested</button>
          <button onClick={() => act("reset")}>↺ Reset to New</button>
        </div>
      )}
    </div>
  );
}

function Composer({ l }: { l: Lead }) {
  const msg = messageFor(l);
  const [copied, setCopied] = useState("");
  const copy = (text: string, tag: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(tag); setTimeout(() => setCopied(""), 1300); }).catch(() => {});
  };
  const isFollow = /follow-up\s*(\d)/i.test(msg.label);
  if (msg.note) return (
    <>
      <span className="badge b-Replied" style={{ marginBottom: 12 }}>Next: {msg.label}</span>
      <div className="note-box" style={{ marginTop: 12 }}>{msg.note}</div>
    </>
  );
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span className={"badge " + (isFollow ? "follow f" + msg.label.replace(/\D/g, "") : "send")}>Next: {msg.label}</span>
        <span style={{ fontSize: 12, color: "var(--tx-3)" }}>{l.sprint_name || "Sprint"} · {l.sent_count || 0} sent so far</span>
      </div>
      <div className="composer">
        <div className="c-hd">
          <span className="lbl">Draft message</span>
          <button className="btn sm" onClick={() => copy(`${msg.subject}\n\n${msg.body}`, "all")}>{copied === "all" ? "Copied ✓" : "Copy all"}</button>
        </div>
        <div className="field">
          <div className="k"><span>Subject</span><button className="btn sm ghost" onClick={() => copy(msg.subject || "", "s")}>{copied === "s" ? "✓" : "Copy"}</button></div>
          <div className="subject copyable" title="Click to copy" onClick={() => copy(msg.subject || "", "s")}>{msg.subject}</div>
        </div>
        <div className="field">
          <div className="k"><span>Message</span><button className="btn sm ghost" onClick={() => copy(msg.body || "", "b")}>{copied === "b" ? "✓" : "Copy"}</button></div>
          <div className="body copyable" title="Click to copy" onClick={() => copy(msg.body || "", "b")}>{msg.body}</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--tx-3)", marginTop: 10 }}>
        {copied === "s" || copied === "b" || copied === "all" ? <span style={{ color: "var(--accent)", fontWeight: 700 }}>Copied ✓ — paste into your email. Your Outlook signature is added automatically.</span>
          : "Click the subject or message to copy it. Your Outlook signature is added automatically — no need to sign off here."}
      </div>
    </>
  );
}

function Drawer({ l, onClose, onAction }: { l: Lead; onClose: () => void; onAction: Act }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" role="dialog">
        <div className="drawer-hd">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-.01em" }}>{l.company}</div>
            <div style={{ color: "var(--tx-2)", fontSize: 13, marginTop: 3 }}>{l.role}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
              <StageBadge l={l} />
              <span className="owner-cell"><OwnerDot name={l.owner} />{l.owner}</span>
              {l.opened && <span className="opened">👁 Opened {String(l.opened_at || "").slice(5, 10)}</span>}
            </div>
          </div>
          <button className="iconbtn" onClick={onClose} title="Close"><Icon d={<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>} /></button>
        </div>
        <div className="drawer-body">
          {l.email && (
            <div style={{ fontSize: 13, marginBottom: 16 }}>
              <span style={{ color: "var(--tx-3)" }}>Email · </span>
              <span style={{ fontWeight: 600 }}>{l.email}</span>
              {l.email_confidence && <span style={{ color: "var(--tx-3)" }}> — {l.email_confidence}</span>}
            </div>
          )}
          <Composer l={l} />
          <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
            <button className="btn primary" onClick={() => onAction(l, "messaged")}>✓ Mark messaged</button>
            <button className="btn" onClick={() => onAction(l, "replied")}>💬 Replied</button>
            <button className="btn ghost" onClick={() => onAction(l, "not_interested")}>Not interested</button>
          </div>
        </div>
      </div>
    </>
  );
}

function RowCard({ l, onOpen, onAction }: { l: Lead; onOpen: (l: Lead) => void; onAction: Act }) {
  const a = actionFor(l);
  return (
    <div className={"rowcard" + (l.status === "No" ? " dim" : "")} onClick={() => onOpen(l)} style={{ cursor: "pointer" }}>
      <div className="co-cell">
        <div className="co">{l.company}</div>
        <div className="co-sub"><StageBadge l={l} />{l.opened && <span className="opened">👁</span>}</div>
      </div>
      <div className="role">{l.role || "—"}</div>
      <div className="owner-cell"><OwnerDot name={l.owner} />{l.owner}</div>
      <div>{l.sprint_name ? <span className="badge sprint">{l.sprint_name}</span> : "—"}</div>
      <div className="email-cell">
        {l.email ? <><div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{l.email}</div><div className="conf">{l.email_confidence}</div></>
          : <span style={{ color: "var(--tx-3)" }}>no email yet</span>}
      </div>
      <div className="actions-cell" onClick={(e) => e.stopPropagation()}>
        {a
          ? <button className={"btn primary sm" + (a.kind === "follow" ? " btn-f" + followLevel(l) : "")} onClick={() => onOpen(l)}>{MailIcon}{a.label}</button>
          : <button className="btn sm" onClick={() => onOpen(l)}>{MailIcon}View</button>}
        <StatusMenu l={l} onAction={onAction} />
      </div>
    </div>
  );
}

function Empty() {
  return <div className="empty"><div className="big">🎉 All caught up</div>Nothing matches this filter right now.</div>;
}

function FocusLayout({ rows, onOpen, onAction }: { rows: Lead[]; onOpen: (l: Lead) => void; onAction: Act }) {
  const groups = useMemo(() => {
    const send: Lead[] = [], follow: Lead[] = [], waiting: Lead[] = [], done: Lead[] = [];
    rows.forEach((l) => {
      const a = actionFor(l);
      if (a && a.kind === "send") send.push(l);
      else if (a) follow.push(l);
      else if (l.status === "No" || norm(l.status) === "Replied") done.push(l);
      else waiting.push(l);
    });
    return [
      { key: "send", t: "Send first email", hint: "New leads with no outreach yet", items: send },
      { key: "follow", t: "Follow-up due", hint: "Sent 4+ days ago, no reply", items: follow },
      { key: "waiting", t: "Waiting", hint: "Recently contacted — nothing to do yet", items: waiting },
      { key: "done", t: "Closed", hint: "Replied or not interested", items: done },
    ].filter((g) => g.items.length);
  }, [rows]);
  if (!rows.length) return <Empty />;
  return (
    <div>
      {groups.map((g) => (
        <div key={g.key}>
          <div className="group-h"><span className="t">{g.t}</span><span className="n">{g.items.length}</span><span className="hint">{g.hint}</span></div>
          <div className="list">{g.items.map((l) => <RowCard key={l.id} l={l} onOpen={onOpen} onAction={onAction} />)}</div>
        </div>
      ))}
    </div>
  );
}

function BoardLayout({ rows, onOpen }: { rows: Lead[]; onOpen: (l: Lead) => void }) {
  const cols = [
    { key: "New", t: "New", f: (l: Lead) => l.status === "New" },
    { key: "Sent", t: "Sent", f: (l: Lead) => l.status === "Sent" },
    { key: "Replied", t: "Replied", f: (l: Lead) => norm(l.status) === "Replied" },
    { key: "No", t: "Not interested", f: (l: Lead) => l.status === "No" },
  ];
  return (
    <div className="board">
      {cols.map((c) => {
        const items = rows.filter(c.f);
        return (
          <div className="col" key={c.key}>
            <div className="col-h"><span className="t">{c.t}</span><span className="n">{items.length}</span></div>
            <div className="col-list">
              {items.map((l) => (
                <div className="mini" key={l.id} onClick={() => onOpen(l)}>
                  <div className="co">{l.company}</div>
                  <div className="role">{l.role || "—"}</div>
                  <div className="mini-foot"><span className="owner-cell"><OwnerDot name={l.owner} /></span><TodoBadge l={l} /></div>
                </div>
              ))}
              {!items.length && <div style={{ color: "var(--tx-3)", fontSize: 12, padding: "8px 2px" }}>Empty</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SplitLayout({ rows, sel, setSel, onAction }: { rows: Lead[]; sel: number | null; setSel: (n: number) => void; onAction: Act }) {
  const cur = rows.find((l) => l.id === sel) || rows[0];
  useEffect(() => { if (cur && cur.id !== sel) setSel(cur.id); }, [cur, sel, setSel]);
  if (!rows.length) return <Empty />;
  return (
    <div className="split">
      <div className="split-list">
        {rows.map((l) => (
          <div key={l.id} className={"srow" + (cur && l.id === cur.id ? " sel" : "")} onClick={() => setSel(l.id)}>
            <div style={{ minWidth: 0 }}>
              <div className="co">{l.company}</div>
              <div className="role" style={{ margin: "2px 0 6px", WebkitLineClamp: 1 }}>{l.role}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}><StageBadge l={l} /><TodoBadge l={l} /></div>
            </div>
            <span className="owner-cell"><OwnerDot name={l.owner} /></span>
          </div>
        ))}
      </div>
      {cur && (
        <div className="detail">
          <div className="detail-hd">
            <div style={{ fontWeight: 800, fontSize: 17 }}>{cur.company}</div>
            <div style={{ color: "var(--tx-2)", fontSize: 13, marginTop: 2 }}>{cur.role}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span className="owner-cell"><OwnerDot name={cur.owner} />{cur.owner}</span>
              {cur.email && <span style={{ fontSize: 12.5, color: "var(--tx-2)" }}>{cur.email}</span>}
              {cur.opened && <span className="opened">👁 Opened</span>}
            </div>
          </div>
          <div className="detail-body">
            <Composer l={cur} />
            <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
              <button className="btn primary" onClick={() => onAction(cur, "messaged")}>✓ Mark messaged</button>
              <button className="btn" onClick={() => onAction(cur, "replied")}>💬 Replied</button>
              <button className="btn ghost" onClick={() => onAction(cur, "not_interested")}>Not interested</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- app ---------------- */
const NEEDS = "Needs action";
const STATUSES = [NEEDS, "All", "New", "Sent", "Replied", "No"];
const STATUS_LABEL: Record<string, string> = { No: "Not interested" };
const REP_BY_EMAIL: Record<string, string> = {
  "byron.giraldo@nearwork.co": "Byron", "stephany.picos@nearwork.co": "Stephany",
  "nany.guerra@nearwork.co": "Nany", "daniela.jessurum@nearwork.co": "Dani",
};

export default function LeadsClient() {
  const { data: session } = useSession();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [owner, setOwner] = useState("All");
  const [status, setStatus] = useState(NEEDS);
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [ownerTouched, setOwnerTouched] = useState(false);
  const [layout, setLayout] = useState<"focus" | "split" | "board">("focus");
  const [dark, setDark] = useState(false);

  async function load(silent = false) {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const [lr, sr] = await Promise.all([fetch("/api/leads", { cache: "no-store" }), fetch("/api/sprints", { cache: "no-store" })]);
      setLeads(lr.ok ? await lr.json() : []);
      setSprints(sr.ok ? await sr.json() : []);
      setUpdatedAt(Date.now());
    } finally { setLoading(false); setRefreshing(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { const id = setInterval(() => load(true), 60000); return () => clearInterval(id); }, []);

  // preferences
  useEffect(() => {
    const so = localStorage.getItem("nw_owner"); if (so) { setOwner(so); setOwnerTouched(true); }
    const sl = localStorage.getItem("nw_layout") as any; if (sl) setLayout(sl);
    const sd = localStorage.getItem("nw_dark");
    const d = sd != null ? sd === "1" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(d);
  }, []);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);

  useEffect(() => {
    if (ownerTouched || !leads.length) return;
    const me = REP_BY_EMAIL[(session?.user?.email || "").toLowerCase()];
    if (me && leads.some((l) => (l.owner || "") === me)) setOwner(me);
  }, [session, leads, ownerTouched]);

  const pickOwner = (o: string) => { setOwner(o); setOwnerTouched(true); localStorage.setItem("nw_owner", o); };
  const pickLayout = (v: "focus" | "split" | "board") => { setLayout(v); localStorage.setItem("nw_layout", v); };
  const toggleDark = () => { setDark((d) => { localStorage.setItem("nw_dark", d ? "0" : "1"); return !d; }); };

  async function patch(id: number, body: Record<string, any>) {
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, ...body } : l)));
    await fetch(`/api/leads/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  function doAction(l: Lead, action: string) {
    if (action === "messaged") patch(l.id, { status: "Sent", sent_count: (l.sent_count || 0) + 1, last_activity: todayISO() });
    else if (action === "messaged_date") {
      const d = window.prompt("What date did you message them? (YYYY-MM-DD)", todayISO());
      if (!d) return;
      if (/^\d{4}-\d{2}-\d{2}$/.test(d.trim())) patch(l.id, { status: "Sent", sent_count: (l.sent_count || 0) + 1, last_activity: d.trim() });
      else window.alert("Please use the format YYYY-MM-DD, e.g. 2026-07-10");
    } else if (action === "replied") patch(l.id, { status: "Replied" });
    else if (action === "not_interested") patch(l.id, { status: "No" });
    else if (action === "reset") patch(l.id, { status: "New", sent_count: 0, reset: true });
    if (action !== "messaged" && action !== "messaged_date") setDrawer(null);
  }

  async function refresh() {
    setRefreshing(true);
    try { await fetch("/api/refresh-hubspot", { method: "POST" }); } catch { /* ignore */ }
    await load(true);
  }

  const bestRate = useMemo(() => Math.max(0, ...sprints.map((s) => s.reply_rate)), [sprints]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { needs: 0, total: 0, New: 0, Sent: 0, Replied: 0 };
    leads.forEach((l) => {
      if (l.status === "No") return;
      c.total++;
      if (isDue(l)) c.needs++;
      const s = norm(l.status);
      if (s === "Replied") c.Replied++; else c[s] = (c[s] || 0) + 1;
    });
    return c;
  }, [leads]);

  const matchStatus = (l: Lead) =>
    status === "All" ? l.status !== "No"
      : status === NEEDS ? isDue(l)
        : status === "No" ? l.status === "No"
          : norm(l.status) === status;

  const owners = useMemo(() => ["All", ...Array.from(new Set(leads.map((l) => l.owner || "—")))], [leads]);
  const ownerCount = (o: string) => leads.filter((l) => (o === "All" || (l.owner || "—") === o) && matchStatus(l)).length;

  const rows = useMemo(() => leads.filter((l) =>
    (owner === "All" || (l.owner || "—") === owner) && matchStatus(l) &&
    (query === "" || l.company.toLowerCase().includes(query.toLowerCase()))
  ), [leads, owner, status, query]);

  const drawerLead = leads.find((l) => l.id === drawer) || null;
  const email = session?.user?.email || "";

  return (
    <div className="app">
      <div className="hd">
        <div className="brand-row">
          <div className="logo">N</div>
          <div>
            <div className="brand">Nearwork · Leads</div>
            <div className="sub">leads.nearwork.co — live pipeline. Changes save instantly for the whole team.</div>
          </div>
        </div>
        <div className="hd-right">
          <button className="btn" onClick={refresh} disabled={refreshing} title="Pull the latest contacted status from HubSpot + Sent folders">
            {refreshing ? "Refreshing…" : "↻ Refresh"}
          </button>
          {updatedAt > 0 && <span style={{ fontSize: 12.5, color: "var(--tx-3)" }}>Updated {new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
          <button className="iconbtn" onClick={toggleDark} title="Toggle dark mode">{dark ? "☀" : "🌙"}</button>
          {email && (
            <div className="who">
              <span className="avatar">{initials(REP_BY_EMAIL[email.toLowerCase()] || email)}</span>
              <span>{email}</span>
              <button className="btn sm ghost" onClick={() => signOut({ callbackUrl: "/signin" })}>Sign out</button>
            </div>
          )}
        </div>
      </div>

      {sprints.length > 0 && (
        <div className="ab-wrap">
          <div className="section-h">Sprint performance · A/B test</div>
          <div className="ab-grid">
            {sprints.map((s) => {
              const win = s.reply_rate > 0 && s.reply_rate === bestRate;
              return (
                <div className={"ab-card" + (win ? " win" : "")} key={s.id}>
                  <div className="accent-bar" />
                  <div className="ab-top">
                    <div><span className="ab-name">{s.name}</span><span className="ab-since"> · since {(s.start_date || "").slice(0, 10)}</span></div>
                    {win && <span className="win-tag">▲ Best reply rate</span>}
                  </div>
                  <div className="ab-focus">{s.focus}</div>
                  <div className="ab-metrics">
                    <div className="ab-rate"><span className="v">{s.reply_rate}%</span><span className="k">Reply rate</span></div>
                    <div className="ab-mini">
                      <div><div className="v">{s.leads}</div><div className="k">Leads</div></div>
                      <div><div className="v">{s.sent}</div><div className="k">Sent</div></div>
                      <div><div className="v">{s.replied}</div><div className="k">Replied</div></div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="kpis">
        <div className={"kpi hero" + (status === NEEDS ? " on" : "")} onClick={() => setStatus(NEEDS)}><div className="n">{counts.needs}</div><div className="l">Needs action</div></div>
        <div className={"kpi" + (status === "All" ? " on" : "")} onClick={() => setStatus("All")}><div className="n">{counts.total}</div><div className="l">Total</div></div>
        <div className={"kpi" + (status === "New" ? " on" : "")} onClick={() => setStatus("New")}><div className="n">{counts.New || 0}</div><div className="l">New</div></div>
        <div className={"kpi" + (status === "Sent" ? " on" : "")} onClick={() => setStatus("Sent")}><div className="n">{counts.Sent || 0}</div><div className="l">Sent</div></div>
        <div className={"kpi" + (status === "Replied" ? " on" : "")} onClick={() => setStatus("Replied")}><div className="n">{counts.Replied || 0}</div><div className="l">Replied</div></div>
      </div>

      <div className="toolbar">
        <div className="chips">
          {owners.map((o) => (
            <div key={o} className={"chip" + (o === owner ? " on" : "")} onClick={() => pickOwner(o)}>
              {o}{o !== "All" && <span className="c">{ownerCount(o)}</span>}
            </div>
          ))}
        </div>
        <div className="divider-v" />
        <div className="chips">
          {STATUSES.map((s) => (
            <div key={s} className={"chip" + (s === status ? " on" : "")} onClick={() => setStatus(s)}>
              {STATUS_LABEL[s] || s}
              {s === NEEDS && <span className="c">{owner === "All" ? counts.needs : ownerCount(owner)}</span>}
            </div>
          ))}
        </div>
        <div className="tb-right">
          <div className="seg">
            {(["focus", "split", "board"] as const).map((v) => (
              <button key={v} className={layout === v ? "on" : ""} onClick={() => pickLayout(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
            ))}
          </div>
          <input className="search" placeholder="Search company…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {loading ? <div className="center">Loading…</div>
        : layout === "board" ? <BoardLayout rows={rows} onOpen={(l) => setDrawer(l.id)} />
          : layout === "split" ? <SplitLayout rows={rows} sel={sel} setSel={setSel} onAction={doAction} />
            : <FocusLayout rows={rows} onOpen={(l) => setDrawer(l.id)} onAction={doAction} />}

      <p className="foot-note">
        Live app — edits save to the database and reflect for the whole team. The daily routine adds new leads nightly
        (the only place AI is used); it never overwrites your changes. Sprints define the message sequence and the A/B test.
      </p>

      {drawerLead && <Drawer l={drawerLead} onClose={() => setDrawer(null)} onAction={doAction} />}
    </div>
  );
}
