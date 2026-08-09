"use client";
import React, { useEffect, useMemo, useState } from "react";
import { signOut } from "next-auth/react";
import {
  Lead, actionFor, nextStep, norm, zoneChip, theirTime, windowHere, callWindow,
  MAX_CALL_ATTEMPTS,
} from "@/lib/cadence";
import {
  OwnerDot, StageBadge, TouchDots, Copyable, EmailPanel, SchedulePanel,
  PhoneIcon, MailIcon, CloseIcon,
} from "./ui";

type Activity = { id: number; actor: string; action: string; note: string; ts: string; company: string };
type Variant = { variant: string; leads: number; sent: number; opened: number; replied: number; reply_rate: number; open_rate: number };
type Payload = { leads: Lead[]; activity: Activity[]; variants: Variant[]; me: string; generated: string };
type View = "day" | "calls" | "leads" | "ab" | "activity";

const OUTCOMES = ["Connected", "Voicemail", "No answer", "Wrong number", "Gatekeeper"];
const INTERESTS = ["Hot", "Warm", "Cold"];
const OBJECTIONS = ["Happy with current", "No budget", "Not hiring now", "Wants US-based only",
                    "Send info by email", "Timing — later this quarter", "Other"];
const ICON: Record<string, string> = { call: "☎", email: "✉", status: "💬", callback: "＋" };

const fmtDay = (d: Date | string | null) => {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toLocaleDateString([], { month: "short", day: "numeric" });
};

/** The old page wrote raw JSON into activity_log.note; render it as a sentence. */
function activityText(a: Activity): string {
  const n = (a.note || "").trim();
  if (!n.startsWith("{")) return n;
  try {
    const o = JSON.parse(n);
    if (o.status === "No") return "marked not interested";
    if (o.status === "Replied") return "replied";
    if (o.status === "Sent") return `email ${o.sent_count || 1} sent`;
    return Object.entries(o).map(([k, v]) => `${k} ${v}`).join(" · ");
  } catch { return n; }
}

export default function CommandCenter({ initial }: { initial: Payload }) {
  const [data, setData] = useState<Payload>(initial);
  const [view, setView] = useState<View>("day");
  const [drawer, setDrawer] = useState<Lead | null>(null);
  const [logging, setLogging] = useState<Lead | null>(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  useEffect(() => { const v = sessionStorage.getItem("cc.view") as View | null; if (v) setView(v); }, []);
  useEffect(() => { sessionStorage.setItem("cc.view", view); }, [view]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 2600); return () => clearTimeout(t); }, [toast]);

  const leads = data.leads || [];

  async function refresh() {
    const r = await fetch("/api/cc", { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }
  async function act(lead: Lead, body: any, msg: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/cc/log", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id, ...body }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "failed");
      await refresh(); setToast(msg);
    } catch (e: any) { setToast(`Couldn't save — ${e.message}`); }
    finally { setBusy(false); }
  }

  const callQueue = useMemo(() => leads.filter((l) => actionFor(l)?.kind === "call"), [leads]);
  const emailQueue = useMemo(() => leads.filter((l) => { const a = actionFor(l); return a?.kind === "send" || a?.kind === "follow"; }), [leads]);
  const replies = useMemo(() => leads.filter((l) => norm(l.status) === "Replied"), [leads]);
  const needs = useMemo(() => leads.filter((l) => actionFor(l)), [leads]);

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand-row">
          <div className="logo">N</div>
          <div>
            <div style={{ fontWeight: 600 }}>Nearwork</div>
            <div style={{ color: "var(--tx-3)", fontSize: 11.5 }}>Command center</div>
          </div>
        </div>

        <nav className="nav">
          <div className="grp">TODAY</div>
          <button className={view === "day" ? "on" : ""} onClick={() => setView("day")}>My Day<span className="n">{needs.length}</span></button>
          <button className={view === "calls" ? "on" : ""} onClick={() => setView("calls")}>Calls<span className="n">{callQueue.length}</span></button>
          <div className="grp">PIPELINE</div>
          <button className={view === "leads" ? "on" : ""} onClick={() => setView("leads")}>Leads<span className="n">{leads.length}</span></button>
          <button className={view === "ab" ? "on" : ""} onClick={() => setView("ab")}>A/B test</button>
          <button className={view === "activity" ? "on" : ""} onClick={() => setView("activity")}>Activity</button>
        </nav>

        <div className="side-foot">
          <button className="btn sync" onClick={async () => { await fetch("/api/refresh-hubspot").catch(() => {}); await refresh(); setToast("Synced to HubSpot"); }}>
            Sync to HubSpot
          </button>
          <div className="foot-note">
            Updated {new Date(data.generated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div className="who">
            <OwnerDot name={data.me} />
            <span style={{ flex: 1 }}>{data.me}</span>
            <button className="iconbtn" onClick={() => setDark(!dark)} title="Dark mode">{dark ? "☀" : "☾"}</button>
          </div>
          <button className="btn sm ghost" onClick={() => signOut({ callbackUrl: "/signin" })}>Sign out</button>
        </div>
      </aside>

      <main className="main">
        {view === "day" && <MyDay {...{ callQueue, emailQueue, replies, activity: data.activity || [], go: setView, onOpen: setDrawer, onLog: setLogging, refresh }} />}
        {view === "calls" && <CallsView {...{ queue: callQueue, me: data.me, onOpen: setDrawer, onLog: setLogging }} />}
        {view === "leads" && <LeadsView {...{ leads, onOpen: setDrawer, onLog: setLogging }} />}
        {view === "ab" && <ABView variants={data.variants || []} />}
        {view === "activity" && <ActivityView activity={data.activity || []} />}
      </main>

      {drawer && (
        <LeadDrawer
          l={drawer} onClose={() => setDrawer(null)}
          onLog={(l: Lead) => { setDrawer(null); setLogging(l); }}
          onSent={(l: Lead) => act(l, { action: "sent" }, "Marked as sent")}
          onStatus={(l: Lead, s: string) => act(l, { action: "status", status: s }, s === "No" ? "Marked not interested" : `Marked ${s}`)}
          busy={busy}
        />
      )}
      {logging && (
        <LogCallModal
          l={logging} onClose={() => setLogging(null)} busy={busy}
          onSave={async (p: any) => { await act(logging, { action: "call", ...p }, "Call logged"); setLogging(null); }}
          onCallback={async (d: string, t: string) => { await act(logging, { action: "callback", callback_date: d, callback_time: t }, "Callback scheduled"); setLogging(null); }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ cards */

function CallCard({ l, rank, onLog, onOpen }: any) {
  const w = callWindow(l);
  const z = zoneChip(l);
  const win = windowHere(l);
  return (
    <div className="callcard" onClick={() => onOpen(l)} style={{ cursor: "pointer" }}>
      <div className="rank">{rank}</div>
      <div style={{ minWidth: 0 }}>
        <div className="co">{l.company}</div>
        <div className="meta">
          <span className="clip">{l.role}</span>
          <span className="pairsep">{l.contact_title || "contact unknown"}</span>
        </div>
        <div className="meta">
          <span className="clip">{l.call_count ? `${l.call_count} of ${MAX_CALL_ATTEMPTS} attempts` : "Never called"}</span>
          {nextStep(l) && <span className="pairsep">Next: {nextStep(l)!.label} {fmtDay(nextStep(l)!.due).toLowerCase()}</span>}
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="phone">
          {l.phone
            ? <Copyable text={l.phone}>{l.phone}</Copyable>
            : <span style={{ color: "var(--tx-3)", fontWeight: 600, fontSize: 13 }}>No number yet</span>}
        </div>
        <div className="tzcell">
          <div className="tzrow">
            {z && <span className="zone">{z}</span>}
            {theirTime(l) && <><b>{theirTime(l)}</b> their time</>}
            <span className={"tz " + (w.state === "good" ? "ok" : "no")}>
              {w.state === "good" ? "good to call" : w.state === "dnc" ? "do not call" : "outside hours"}
            </span>
          </div>
          {win && <div className="tzrow">{win}</div>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifySelf: "end" }} onClick={(e) => e.stopPropagation()}>
        <OwnerDot name={l.owner} />
        {l.phone
          ? <button className="btn primary" onClick={() => onLog(l)} disabled={l.dnc}>{PhoneIcon}Call</button>
          : <button className="btn" onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(`${l.company} ${l.contact_name || ""} phone`)}`, "_blank")}>Find number</button>}
      </div>
    </div>
  );
}

function MailCard({ l, onOpen }: any) {
  const [c, setC] = useState(false);
  return (
    <div className="mailcard" onClick={() => onOpen(l)} style={{ cursor: "pointer" }}>
      <OwnerDot name={l.owner} />
      <div style={{ minWidth: 0 }}>
        <div className="co">{l.company}</div>
        <div className="subj">{nextStep(l)?.label || "Next"}: {l.gen_subject || l.role}</div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <TouchDots l={l} />
        <button className="btn sm" onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard?.writeText(`${l.gen_subject || ""}\n\n${l.gen_body || ""}`)
            .then(() => { setC(true); setTimeout(() => setC(false), 1300); }).catch(() => {});
        }}>{c ? "Copied ✓" : "Copy"}</button>
        <button className="btn sm primary" onClick={(e) => { e.stopPropagation(); onOpen(l); }}>{MailIcon}Open</button>
      </div>
    </div>
  );
}

function LeadRow({ l, onOpen, onLog }: any) {
  const a = actionFor(l);
  const s = nextStep(l);
  return (
    <div className={"leadrow" + (l.status === "No" ? " dim" : "")} onClick={() => onOpen(l)}>
      <div className="owner-cell"><OwnerDot name={l.owner} /></div>
      <div>
        <div className="co-cell">
          <span className="co">{l.company}</span>
          {l.opened && <span className="opened">👁</span>}
        </div>
        <div className="lr-line2">
          <StageBadge l={l} />
          {zoneChip(l) && <span className="zone">{zoneChip(l)}</span>}
          <span className="role">{l.role}</span>
        </div>
      </div>
      <div className="lr-dots"><TouchDots l={l} /></div>
      <div className="lr-next"><span className="k">Next</span>{s ? `${s.label} · ${fmtDay(s.due)}` : "done"}</div>
      <div className="actions-cell" onClick={(e) => e.stopPropagation()}>
        <button className="iconbtn" onClick={() => onLog(l)} disabled={l.dnc || !l.phone} title="Log a call">{PhoneIcon}</button>
        <button className={"btn sm" + (a ? " primary" : "")} onClick={() => onOpen(l)}>{MailIcon}{a ? "Email" : "View"}</button>
      </div>
    </div>
  );
}

function ActivityFeed({ items }: { items: Activity[] }) {
  return (
    <div className="feed">
      {items.map((a) => (
        <div className="fitem" key={a.id}>
          <OwnerDot name={a.actor} />
          <div className="txt">
            <span style={{ marginRight: 6, color: "var(--tx-3)" }}>{ICON[a.action] || "•"}</span>
            <b>{a.company}</b> — {activityText(a)}
          </div>
          <div className="when">{new Date(a.ts).toLocaleDateString([], { month: "short", day: "numeric" })}</div>
        </div>
      ))}
      {!items.length && <div style={{ fontSize: 13, color: "var(--tx-3)" }}>Nothing logged yet.</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- My Day */

function MyDay({ callQueue, emailQueue, replies, activity, go, onOpen, onLog, refresh }: any) {
  const [tab, setTab] = useState<"calls" | "emails">("calls");
  const today = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  return (
    <>
      <div className="page-h">
        <div>
          <div className="page-t">My Day</div>
          <div className="page-s">{today} · everything that needs a person today.</div>
        </div>
        <button className="btn" onClick={refresh}>↻ Refresh from HubSpot</button>
      </div>

      <div className="day-grid">
        <div className="tile call" onClick={() => setTab("calls")}>
          <div className="n">{callQueue.length}</div><div className="l">Calls queued</div>
          <div className="h">Follow-up sent, buffer passed</div>
        </div>
        <div className="tile" onClick={() => setTab("emails")}>
          <div className="n">{emailQueue.length}</div><div className="l">Emails due</div>
          <div className="h">First touches and follow-ups</div>
        </div>
        <div className="tile" onClick={() => go("leads")}>
          <div className="n">{replies.length}</div><div className="l">Replies to handle</div>
          <div className="h">Waiting on you in the inbox</div>
        </div>
      </div>

      <div className="cols">
        <div>
          <div className="tabs">
            <button className={tab === "calls" ? "on" : ""} onClick={() => setTab("calls")}>Calls<span className="n">{callQueue.length}</span></button>
            <button className={tab === "emails" ? "on" : ""} onClick={() => setTab("emails")}>Emails<span className="n">{emailQueue.length}</span></button>
            <button style={{ marginLeft: "auto", color: "var(--tx-3)" }} onClick={() => go(tab === "calls" ? "calls" : "leads")}>Open full list →</button>
          </div>
          <div className="stack">
            {tab === "calls" && callQueue.slice(0, 5).map((l: Lead, i: number) => <CallCard key={l.id} l={l} rank={i + 1} onLog={onLog} onOpen={onOpen} />)}
            {tab === "calls" && !callQueue.length && <div className="panel" style={{ color: "var(--tx-3)", fontSize: 13 }}>Call queue is clear.</div>}
            {tab === "emails" && emailQueue.slice(0, 6).map((l: Lead) => <MailCard key={l.id} l={l} onOpen={onOpen} />)}
            {tab === "emails" && !emailQueue.length && <div className="panel" style={{ color: "var(--tx-3)", fontSize: 13 }}>No emails due today.</div>}
          </div>
        </div>
        <div className="panel">
          <div className="panel-h">
            <span className="t">Team activity</span>
            <button className="btn sm ghost" onClick={() => go("activity")}>All →</button>
          </div>
          <ActivityFeed items={activity.slice(0, 5)} />
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Calls */

function CallsView({ queue, me, onOpen, onLog }: any) {
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const sets: [string, string, Lead[]][] = [
    ["warm", "Warm", queue.filter((l: Lead) => l.opened)],
    ["overdue", "Overdue", queue.filter((l: Lead) => (l.call_count || 0) > 0)],
    ["mine", "My list", queue.filter((l: Lead) => l.owner === me)],
    ["high", "High value", queue.filter((l: Lead) => (l.sent_count || 0) >= 2)],
    ["all", "All", queue],
  ];
  const rows = (sets.find((s) => s[0] === tab)?.[2] || queue)
    .filter((l: Lead) => !query || l.company.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <div className="page-h">
        <div>
          <div className="page-t">Calls</div>
          <div className="page-s">A lead enters the queue after follow-up 1 plus two business days. Three attempts, then email carries it.</div>
        </div>
      </div>
      <div className="toolbar">
        <div className="tabs">
          {sets.map(([k, label, arr]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}<span className="n">{arr.length}</span></button>
          ))}
        </div>
        <div className="tb-right"><input className="search" placeholder="Search company…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      </div>
      {rows.length ? (
        <div className="stack">
          {rows.map((l: Lead, i: number) => <CallCard key={l.id} l={l} rank={i + 1} onLog={onLog} onOpen={onOpen} />)}
        </div>
      ) : <div className="empty"><div className="big">Queue is clear</div>Nothing to call right now.</div>}
    </>
  );
}

/* ------------------------------------------------------------------ Leads */

function LeadsView({ leads, onOpen, onLog }: any) {
  const [status, setStatus] = useState("Needs action");
  const [query, setQuery] = useState("");
  const match = (l: Lead) =>
    status === "All" ? l.status !== "No"
    : status === "Needs action" ? !!actionFor(l)
    : status === "No" ? l.status === "No"
    : norm(l.status) === status;
  const rows = leads.filter((l: Lead) => match(l) && (!query || l.company.toLowerCase().includes(query.toLowerCase())));
  const groups = [
    { t: "Send first email", hint: "New leads with no outreach yet", items: rows.filter((l: Lead) => actionFor(l)?.kind === "send") },
    { t: "Follow-up due", hint: "Due on the Variant C cadence", items: rows.filter((l: Lead) => actionFor(l)?.kind === "follow") },
    { t: "Call due", hint: "Follow-up sent, buffer passed", items: rows.filter((l: Lead) => actionFor(l)?.kind === "call") },
    { t: "Waiting", hint: "Recently contacted — nothing to do yet", items: rows.filter((l: Lead) => !actionFor(l) && norm(l.status) !== "Replied" && l.status !== "No") },
    { t: "Closed", hint: "Replied or not interested", items: rows.filter((l: Lead) => norm(l.status) === "Replied" || l.status === "No") },
  ].filter((g) => g.items.length);

  return (
    <>
      <div className="page-h">
        <div>
          <div className="page-t">Leads</div>
          <div className="page-s">Every company in the pipeline. Reps show as a coloured dot, not a name.</div>
        </div>
      </div>
      <div className="toolbar">
        <div className="chips">
          {["Needs action", "All", "New", "Sent", "Replied", "No"].map((s) => (
            <div key={s} className={"chip" + (s === status ? " on" : "")} onClick={() => setStatus(s)}>
              {s === "No" ? "Not interested" : s}
            </div>
          ))}
        </div>
        <div className="tb-right"><input className="search" placeholder="Search company…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      </div>
      {groups.length ? groups.map((g) => (
        <div key={g.t}>
          <div className="group-h"><span className="t">{g.t}</span><span className="n">{g.items.length}</span><span className="hint">{g.hint}</span></div>
          <div className="list">{g.items.map((l: Lead) => <LeadRow key={l.id} l={l} onOpen={onOpen} onLog={onLog} />)}</div>
        </div>
      )) : <div className="empty"><div className="big">🎉 All caught up</div>Nothing matches this filter right now.</div>}
    </>
  );
}

/* --------------------------------------------------------------- A/B, feed */

function ABView({ variants }: { variants: Variant[] }) {
  const best = [...variants].sort((a, b) => b.reply_rate - a.reply_rate)[0];
  const label = (v: string) => v === "C" ? "Variant C · price-first" : `Variant ${v} · Apollo`;
  const totalSent = variants.reduce((n, v) => n + v.sent, 0);
  return (
    <>
      <div className="page-h">
        <div>
          <div className="page-t">A/B test</div>
          <div className="page-s">Variant C runs on the leads you send yourself; A and B run inside Apollo.</div>
        </div>
      </div>
      <div className="verdict">
        <div className="verdict-t">
          {best && best.sent > 0 && best.reply_rate > 0
            ? `${label(best.variant)} is ahead — ${best.reply_rate}% reply rate`
            : "Not enough replies yet to call a winner"}
        </div>
        <div className="verdict-s">{totalSent} emails sent across {variants.length} variants.</div>
      </div>
      <div className="panel ab-table">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={{ textAlign: "left" }}>Variant</th><th>Leads</th><th>Sent</th><th>Opened</th><th>Replied</th><th>Reply rate</th></tr></thead>
          <tbody>
            {variants.map((v) => (
              <tr key={v.variant}>
                <td style={{ textAlign: "left" }}><b>{label(v.variant)}</b></td>
                <td>{v.leads}</td><td>{v.sent}</td><td>{v.opened}</td><td>{v.replied}</td><td><b>{v.reply_rate}%</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ActivityView({ activity }: { activity: Activity[] }) {
  return (
    <>
      <div className="page-h">
        <div><div className="page-t">Activity</div><div className="page-s">Everything the team has logged, newest first.</div></div>
      </div>
      <div className="panel"><ActivityFeed items={activity} /></div>
    </>
  );
}

/* ----------------------------------------------------------------- drawer */

function LeadDrawer({ l, onClose, onLog, onSent, onStatus, busy }: any) {
  const [tab, setTab] = useState<"email" | "details" | "calls">("email");
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label={l.company}>
        <div className="drawer-hd">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 18, letterSpacing: "-.01em" }}>{l.company}</div>
            <div style={{ color: "var(--tx-2)", fontSize: 13, marginTop: 3 }}>
              {[l.role, l.contact_name, l.contact_title].filter(Boolean).join(" · ")}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
              <StageBadge l={l} /><OwnerDot name={l.owner} />
              {zoneChip(l) && <span className="zone">{zoneChip(l)} {theirTime(l)}</span>}
            </div>
          </div>
          <button className="iconbtn" onClick={onClose} title="Close">{CloseIcon}</button>
        </div>
        <div className="drawer-body">
          <div className="tabs">
            <button className={tab === "email" ? "on" : ""} onClick={() => setTab("email")}>Email</button>
            <button className={tab === "details" ? "on" : ""} onClick={() => setTab("details")}>Details</button>
            <button className={tab === "calls" ? "on" : ""} onClick={() => setTab("calls")}>Calls<span className="n">{l.call_count || 0}</span></button>
          </div>

          {tab === "email" && (
            <>
              <div style={{ marginBottom: 14 }}><EmailPanel l={l} /></div>
              <SchedulePanel l={l} />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn primary" disabled={busy} onClick={() => onSent(l)}>{MailIcon}Mark messaged</button>
                <button className="btn" onClick={() => onLog(l)} disabled={l.dnc || !l.phone}>{PhoneIcon}Log a call</button>
                <button className="btn" disabled={busy} onClick={() => onStatus(l, "Replied")}>💬 Replied</button>
                <button className="btn ghost" disabled={busy} onClick={() => onStatus(l, "No")}>Not interested</button>
              </div>
            </>
          )}

          {tab === "details" && (
            <div className="detail-body">
              <div className="poc-name"><Copyable text={l.contact_name || ""}>{l.contact_name || "—"}</Copyable></div>
              <div className="poc-title">{l.contact_title || ""}</div>
              <div className="poc-phone">
                {l.phone ? <Copyable text={l.phone}>{l.phone}</Copyable> : <span style={{ color: "var(--tx-3)" }}>No phone number yet</span>}
              </div>
              <dl className="facts">
                <dt>Email</dt><dd><Copyable text={l.email || ""}>{l.email || "—"}</Copyable></dd>
                <dt>Confidence</dt><dd>{l.email_confidence || "—"}</dd>
                <dt>Website</dt><dd>{l.website || "—"}</dd>
                <dt>Job post</dt><dd>{l.job_url ? <a href={l.job_url} target="_blank" rel="noreferrer">Open posting</a> : "—"}</dd>
                <dt>Source</dt><dd>{l.source || "—"}</dd>
                <dt>Emails sent</dt><dd>{l.sent_count || 0} of 3{l.opened ? " · opened" : ""}</dd>
                <dt>Calls logged</dt><dd>{l.call_count || 0}</dd>
                <dt>Sprint</dt><dd>{l.sprint_name || "—"} · Variant {(l.gen_subject || "").match(/\/mo|\/month/) ? "C" : (l.ab_variant || "—")}</dd>
              </dl>
            </div>
          )}

          {tab === "calls" && (
            <div className="panel" style={{ padding: "14px 16px" }}>
              <div className="panel-h">
                <span className="t">Call history</span>
                <button className="btn sm primary" onClick={() => onLog(l)} disabled={l.dnc || !l.phone}>{PhoneIcon}Log a call</button>
              </div>
              {l.callback_date && (
                <div className="callback-note">Callback booked for <b>{fmtDay(l.callback_date)} {l.callback_time || ""}</b></div>
              )}
              {l.call_count
                ? <div style={{ fontSize: 13, color: "var(--tx-2)" }}>{l.call_count} of {MAX_CALL_ATTEMPTS} attempts · last {fmtDay(l.last_call_at)}</div>
                : <div style={{ fontSize: 13, color: "var(--tx-3)" }}>No calls logged yet.</div>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------- call modal */

function LogCallModal({ l, onClose, onSave, onCallback, busy }: any) {
  const [outcome, setOutcome] = useState("Connected");
  const [spoke, setSpoke] = useState("");
  const [interest, setInterest] = useState("Warm");
  const [objection, setObjection] = useState("");
  const [mins, setMins] = useState("");
  const [notes, setNotes] = useState("");
  const [next, setNext] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [cbDate, setCbDate] = useState("");
  const [cbTime, setCbTime] = useState("");
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <>
      <div className="modal-scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-label={`Log a call for ${l.company}`}>
        <div className="modal-hd">
          <div>
            <div style={{ fontWeight: 600 }}>Log a call · {l.company}</div>
            <div style={{ fontSize: 12, color: "var(--tx-3)" }}>{[l.contact_name, l.contact_title].filter(Boolean).join(", ")}</div>
          </div>
          <button className="iconbtn" onClick={onClose}>{CloseIcon}</button>
        </div>
        <div className="modal-bd">
          <div className="frow"><div className="k">Outcome</div>
            <div className="opts">{OUTCOMES.map((o) => <button key={o} className={"opt" + (outcome === o ? " on" : "")} onClick={() => setOutcome(o)}>{o}</button>)}</div>
          </div>
          <div className="frow"><div className="k">Who you spoke to</div>
            <input className="inp" value={spoke} onChange={(e) => setSpoke(e.target.value)} placeholder={l.contact_name || "Name"} />
          </div>
          <div className="frow"><div className="k">Interest</div>
            <div className="opts">{INTERESTS.map((o) => <button key={o} className={"opt" + (interest === o ? " on" : "")} onClick={() => setInterest(o)}>{o}</button>)}</div>
          </div>
          <div className="frow"><div className="k">Objection</div>
            <select className="inp" value={objection} onChange={(e) => setObjection(e.target.value)}>
              <option value="">— none —</option>
              {OBJECTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="frow"><div className="k">Duration (minutes)</div>
            <input className="inp" type="number" min="0" value={mins} onChange={(e) => setMins(e.target.value)} />
          </div>
          <div className="frow"><div className="k">Notes</div>
            <textarea className="inp ta" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="frow"><div className="k">Next step</div>
            <input className="inp" value={next} onChange={(e) => setNext(e.target.value)} placeholder="e.g. send two profiles" />
          </div>
          <div className="frow"><div className="k">Next step date</div>
            <input className="inp" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
          </div>
          <div className="sep-h" />
          <div className="frow"><div className="k">Callback — in {l.company}&rsquo;s local time</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="inp" type="date" value={cbDate} onChange={(e) => setCbDate(e.target.value)} />
              <input className="inp" type="time" value={cbTime} onChange={(e) => setCbTime(e.target.value)} />
            </div>
            {cbTime && l.tz_offset != null && (
              <div className="callback-note">That is {convertToMine(cbTime, l.tz_offset)} your time (COT).</div>
            )}
          </div>
        </div>
        <div className="modal-ft">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          {cbDate && <button className="btn" disabled={busy} onClick={() => onCallback(cbDate, cbTime)}>Save callback</button>}
          <button className="btn primary" disabled={busy} onClick={() => onSave({
            outcome, spoke_to: spoke, interest, objection,
            duration_sec: mins ? Number(mins) * 60 : null,
            notes, next_step: next, next_step_date: nextDate || null,
          })}>Save call</button>
        </div>
      </div>
    </>
  );
}

function convertToMine(hhmm: string, tz: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const shift = -5 - tz;
  const x = ((h + shift) % 24 + 24) % 24;
  return `${String(x).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
