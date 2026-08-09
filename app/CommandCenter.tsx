"use client";
import React, { useEffect, useMemo, useState } from "react";
import { signOut } from "next-auth/react";
import {
  Lead, actionFor, nextStep, norm, statusLabel, repColor, zoneChip, theirTime, callWindow,
  MAX_CALL_ATTEMPTS,
} from "@/lib/cadence";
import {
  OwnerDot, StageBadge, TouchDots, Copyable, ZoneCell, EmailPanel, SchedulePanel,
  ActionBadge, PhoneIcon, MailIcon, CloseIcon, RefreshIcon,
} from "./ui";

type Activity = { id: number; actor: string; action: string; note: string; ts: string; company: string };
type Variant = { variant: string; leads: number; sent: number; opened: number; replied: number; reply_rate: number; open_rate: number };
type Payload = { leads: Lead[]; activity: Activity[]; variants: Variant[]; me: string; generated: string };

type View = "day" | "calls" | "leads" | "ab" | "activity";

const OUTCOMES = ["Connected", "Voicemail", "No answer", "Wrong number", "Gatekeeper"];
const INTERESTS = ["Hot", "Warm", "Cold"];
const OBJECTIONS = ["Happy with current", "No budget", "Not hiring now", "Wants US-based only",
                    "Send info by email", "Timing — later this quarter", "Other"];

export default function CommandCenter({ initial }: { initial: Payload }) {
  const [data, setData] = useState<Payload>(initial);
  // View state survives a refresh (interaction rule).
  const [view, setView] = useState<View>("day");
  const [open, setOpen] = useState<Lead | null>(null);
  const [callFor, setCallFor] = useState<Lead | null>(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const v = sessionStorage.getItem("cc.view") as View | null;
    if (v) setView(v);
  }, []);
  useEffect(() => { sessionStorage.setItem("cc.view", view); }, [view]);

  const leads = data.leads || [];
  const say = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2200); };

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
      await refresh();
      say(msg);
    } catch (e: any) {
      say(`Couldn't save — ${e.message}`);
    } finally { setBusy(false); }
  }

  /* ---------------------------------------------------------- derived sets */
  const callQueue = useMemo(
    () => leads.filter((l) => { const a = actionFor(l); return a?.kind === "call"; }),
    [leads]
  );
  const emailQueue = useMemo(
    () => leads.filter((l) => { const a = actionFor(l); return a?.kind === "send" || a?.kind === "follow"; }),
    [leads]
  );
  const replies = useMemo(() => leads.filter((l) => norm(l.status) === "Replied"), [leads]);
  const needsAction = useMemo(() => leads.filter((l) => actionFor(l)), [leads]);

  const counts = { day: needsAction.length, calls: callQueue.length, leads: leads.length,
                   ab: data.variants?.length || 0, activity: data.activity?.length || 0 };

  return (
    <div className="app">
      {/* ------------------------------------------------------------ shell */}
      <aside className="side">
        <div className="brand-row">
          <div className="logo">N</div>
          <div>
            <div style={{ fontWeight: 600 }}>Nearwork</div>
            <div style={{ color: "var(--tx-3)", fontSize: 11.5 }}>Command center</div>
          </div>
        </div>

        <nav className="nav">
          <div className="group-h">TODAY</div>
          <NavItem on={view === "day"} onClick={() => setView("day")} label="My Day" n={counts.day} />
          <NavItem on={view === "calls"} onClick={() => setView("calls")} label="Calls" n={counts.calls} />
          <div className="group-h">PIPELINE</div>
          <NavItem on={view === "leads"} onClick={() => setView("leads")} label="Leads" n={counts.leads} />
          <NavItem on={view === "ab"} onClick={() => setView("ab")} label="A/B test" />
          <NavItem on={view === "activity"} onClick={() => setView("activity")} label="Activity" />
        </nav>

        <div className="side-foot">
          <button className="btn sync" onClick={async () => { await fetch("/api/refresh-hubspot").catch(() => {}); await refresh(); say("Synced with HubSpot"); }}>
            Sync to HubSpot
          </button>
          <div className="foot-note">
            Updated {new Date(data.generated).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </div>
          <div className="who">
            <OwnerDot name={data.me} />
            <span style={{ flex: 1 }}>{data.me}</span>
            <button className="btn sm ghost" onClick={() => signOut({ callbackUrl: "/signin" })}>Sign out</button>
          </div>
        </div>
      </aside>

      {/* ------------------------------------------------------------- main */}
      <main className="main">
        {view === "day" && (
          <MyDay
            callQueue={callQueue} emailQueue={emailQueue} replies={replies}
            activity={data.activity || []} go={setView}
            onOpen={setOpen} onCall={setCallFor} onRefresh={refresh}
          />
        )}
        {view === "calls" && (
          <CallsView leads={leads} queue={callQueue} onOpen={setOpen} onCall={setCallFor} me={data.me} />
        )}
        {view === "leads" && (
          <LeadsView leads={leads} onOpen={setOpen} onCall={setCallFor} />
        )}
        {view === "ab" && <ABView variants={data.variants || []} />}
        {view === "activity" && <ActivityView activity={data.activity || []} />}
      </main>

      {open && (
        <LeadDrawer
          l={open} onClose={() => setOpen(null)}
          onCall={(l: Lead) => { setOpen(null); setCallFor(l); }}
          onSent={(l: Lead) => act(l, { action: "sent" }, "Marked as sent")}
          onStatus={(l: Lead, s: string) => act(l, { action: "status", status: s }, s === "No" ? "Marked not interested" : `Marked ${s}`)}
          busy={busy}
        />
      )}

      {callFor && (
        <LogCallModal
          l={callFor} onClose={() => setCallFor(null)}
          onSave={async (payload: any) => { await act(callFor, { action: "call", ...payload }, "Call logged"); setCallFor(null); }}
          onCallback={async (d: string, t: string) => { await act(callFor, { action: "callback", callback_date: d, callback_time: t }, "Callback scheduled"); setCallFor(null); }}
          busy={busy}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function NavItem({ on, onClick, label, n }: { on: boolean; onClick: () => void; label: string; n?: number }) {
  return (
    <button className={"navitem" + (on ? " on" : "")} onClick={onClick}>
      <span>{label}</span>
      {n != null && <span className="n">{n}</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ My Day */

function MyDay({ callQueue, emailQueue, replies, activity, go, onOpen, onCall, onRefresh }: any) {
  const [tab, setTab] = useState<"calls" | "emails">("calls");
  const today = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  const list: Lead[] = tab === "calls" ? callQueue : emailQueue;

  return (
    <>
      <div className="page-h">
        <div>
          <div className="page-t">My Day</div>
          <div className="page-s">{today} · everything that needs a person today.</div>
        </div>
        <button className="btn" onClick={onRefresh}>{RefreshIcon}Refresh from HubSpot</button>
      </div>

      <div className="kpis">
        <Tile n={callQueue.length} label="CALLS QUEUED" hint="Follow-up sent, buffer passed" onClick={() => go("calls")} />
        <Tile n={emailQueue.length} label="EMAILS DUE" hint="First touch or a follow-up" onClick={() => go("leads")} />
        <Tile n={replies.length} label="REPLIES TO HANDLE" hint="Someone wrote back" onClick={() => go("leads")} />
      </div>

      <div className="cols">
        <div className="col">
          <div className="col-h">
            <div className="tabs">
              <button className={tab === "calls" ? "on" : ""} onClick={() => setTab("calls")}>Calls<span className="n">{callQueue.length}</span></button>
              <button className={tab === "emails" ? "on" : ""} onClick={() => setTab("emails")}>Emails<span className="n">{emailQueue.length}</span></button>
            </div>
            <button className="btn sm ghost" onClick={() => go(tab === "calls" ? "calls" : "leads")}>Open full list →</button>
          </div>

          <div className="col-list">
            {list.length === 0 && (
              <div className="empty">
                {tab === "calls"
                  ? "No calls due. A lead enters the queue once follow-up 1 has gone out and two business days have passed."
                  : "Nothing to send right now."}
              </div>
            )}
            {list.slice(0, 12).map((l, i) => (
              <div className="rowcard" key={l.id} onClick={() => onOpen(l)}>
                <div className="rank">{i + 1}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="co">{l.company}</div>
                  <div className="sub">{[l.role, l.contact_title].filter(Boolean).join(" · ")}</div>
                  <div className="meta">
                    {l.call_count ? `${l.call_count} call${l.call_count > 1 ? "s" : ""}` : "Never called"}
                    {" · Next: "}{nextStep(l)?.label || "done"}
                  </div>
                </div>
                <ZoneCell l={l} />
                <OwnerDot name={l.owner} />
                <div className="actions-cell" onClick={(e) => e.stopPropagation()}>
                  {tab === "calls"
                    ? <CallButton l={l} onCall={onCall} />
                    : <button className="btn primary sm" onClick={() => onOpen(l)}>{MailIcon}Email</button>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="col">
          <div className="col-h"><span className="section-h">Team activity</span></div>
          <div className="feed">
            {activity.length === 0 && <div className="empty">Nothing logged yet.</div>}
            {activity.slice(0, 14).map((a: Activity) => (
              <div className="fitem" key={a.id}>
                <OwnerDot name={a.actor} />
                <span className="glyph">{a.action === "call" ? "☎" : a.action === "email" ? "✉" : a.action === "callback" ? "＋" : "💬"}</span>
                <span className="f-txt"><b>{a.company}</b> — {a.note}</span>
                <span className="meta">{new Date(a.ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function Tile({ n, label, hint, onClick }: any) {
  return (
    <div className="tile" onClick={onClick} role="button">
      <div className="kpi">{n}</div>
      <div className="bar-k">{label}</div>
      <div className="meta">{hint}</div>
    </div>
  );
}

/** Phone-first, but the pipeline has no numbers yet — so say so plainly. */
function CallButton({ l, onCall }: { l: Lead; onCall: (l: Lead) => void }) {
  if (l.dnc) return <span className="badge b-No">Do not call</span>;
  if (!l.phone) {
    return (
      <button className="btn sm" title="No phone number on this lead yet"
              onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(`${l.company} ${l.contact_name || ""} phone`)}`, "_blank")}>
        Find number
      </button>
    );
  }
  return <button className="btn primary sm" onClick={() => onCall(l)}>{PhoneIcon}Call</button>;
}

/* ------------------------------------------------------------------- Calls */

function CallsView({ leads, queue, onOpen, onCall, me }: any) {
  const [tab, setTab] = useState("warm");
  const [qs, setQs] = useState("");
  const tabs: [string, string, Lead[]][] = [
    ["warm", "Warm", queue.filter((l: Lead) => l.opened)],
    ["overdue", "Overdue", queue.filter((l: Lead) => (l.call_count || 0) > 0)],
    ["mine", "My list", queue.filter((l: Lead) => l.owner === me)],
    ["high", "High value", queue.filter((l: Lead) => (l.sent_count || 0) >= 2)],
    ["all", "All", queue],
  ];
  const active = tabs.find((t) => t[0] === tab)?.[2] || queue;
  const list = active.filter((l: Lead) => !qs || l.company.toLowerCase().includes(qs.toLowerCase()));

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
          {tabs.map(([k, label, arr]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}<span className="n">{arr.length}</span></button>
          ))}
        </div>
        <input className="search inp" placeholder="Search company…" value={qs} onChange={(e) => setQs(e.target.value)} />
      </div>

      {list.length === 0 && <div className="empty">Nothing in this queue.</div>}
      <div className="list">
        {list.map((l: Lead, i: number) => (
          <div className="callcard" key={l.id} onClick={() => onOpen(l)}>
            <div className="rank">{i + 1}</div>
            <div style={{ minWidth: 0 }}>
              <div className="co">{l.company}</div>
              <div className="sub">{[l.role, l.contact_name, l.contact_title].filter(Boolean).join(" · ")}</div>
              {l.phone
                ? <Copyable text={l.phone} className="phone">{l.phone}</Copyable>
                : <div className="meta">No number yet — Apollo credits reset ~Aug 24</div>}
              <div className="meta">
                {l.call_count ? `${l.call_count} of ${MAX_CALL_ATTEMPTS} attempts` : "Never called"}
              </div>
            </div>
            <ZoneCell l={l} />
            <div className="actions-cell" onClick={(e) => e.stopPropagation()}>
              <CallButton l={l} onCall={onCall} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- Leads */

function LeadsView({ leads, onOpen, onCall }: any) {
  const [chip, setChip] = useState("need");
  const [qs, setQs] = useState("");
  const chips: [string, string, (l: Lead) => boolean][] = [
    ["need", "Needs action", (l) => !!actionFor(l)],
    ["all", "All", () => true],
    ["New", "New", (l) => norm(l.status) === "New"],
    ["Sent", "Sent", (l) => norm(l.status) === "Sent"],
    ["Replied", "Replied", (l) => norm(l.status) === "Replied"],
    ["No", "Not interested", (l) => l.status === "No"],
  ];
  const f = chips.find((c) => c[0] === chip)?.[2] || (() => true);
  const list = leads.filter(f).filter((l: Lead) => !qs || l.company.toLowerCase().includes(qs.toLowerCase()));

  return (
    <>
      <div className="page-h">
        <div>
          <div className="page-t">Leads</div>
          <div className="page-s">{leads.length} in the pipeline · {leads.filter((l: Lead) => actionFor(l)).length} need a person.</div>
        </div>
      </div>
      <div className="toolbar">
        <div className="chips">
          {chips.map(([k, label, fn]) => (
            <button key={k} className={"chip" + (chip === k ? " on" : "")} onClick={() => setChip(k)}>
              {label}<span className="n">{leads.filter(fn).length}</span>
            </button>
          ))}
        </div>
        <input className="search inp" placeholder="Search company…" value={qs} onChange={(e) => setQs(e.target.value)} />
      </div>

      {list.length === 0 && <div className="empty">No leads match.</div>}
      <div className="list">
        {list.map((l: Lead) => (
          <div className={"leadrow" + (l.status === "No" ? " dim" : "")} key={l.id} onClick={() => onOpen(l)}>
            <div className="owner-cell"><OwnerDot name={l.owner} /></div>
            <div style={{ minWidth: 0 }}>
              <div className="co-cell">
                <span className="co">{l.company}</span>
                {l.opened && <span className="opened" title="Genuine open">👁</span>}
              </div>
              <div className="lr-line2">
                <StageBadge l={l} />
                {zoneChip(l) && <span className="zone">{zoneChip(l)}</span>}
                <span className="role">{l.role}</span>
              </div>
            </div>
            <div className="lr-dots"><TouchDots l={l} /></div>
            <div className="lr-next">
              <span className="k">Next</span>
              <ActionBadge l={l} />
            </div>
            <div className="actions-cell" onClick={(e) => e.stopPropagation()}>
              <CallButton l={l} onCall={onCall} />
              <button className="btn sm primary" onClick={() => onOpen(l)}>{MailIcon}Email</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- A/B + feed */

function ABView({ variants }: { variants: Variant[] }) {
  const best = [...variants].sort((a, b) => b.reply_rate - a.reply_rate)[0];
  const label = (v: string) => v === "C" ? "Variant C · price-first (manual)" : `Variant ${v} · Apollo`;
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
          {best && best.sent > 0
            ? `${label(best.variant)} leads at ${best.reply_rate}% reply rate`
            : "Not enough replies yet to call a winner"}
        </div>
        <div className="verdict-s">
          {variants.reduce((n, v) => n + v.sent, 0)} emails sent across {variants.length} variants.
        </div>
      </div>
      <div className="ab-table panel">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Variant</th>
              <th>Leads</th><th>Sent</th><th>Opened</th><th>Replied</th><th>Reply rate</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              <tr key={v.variant}>
                <td style={{ textAlign: "left" }}><b>{label(v.variant)}</b></td>
                <td>{v.leads}</td><td>{v.sent}</td><td>{v.opened}</td><td>{v.replied}</td>
                <td><b>{v.reply_rate}%</b></td>
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
        <div><div className="page-t">Activity</div><div className="page-s">Everything the team has logged.</div></div>
      </div>
      <div className="feed panel">
        {activity.length === 0 && <div className="empty">Nothing logged yet.</div>}
        {activity.map((a) => (
          <div className="fitem" key={a.id}>
            <OwnerDot name={a.actor} />
            <span className="glyph">{a.action === "call" ? "☎" : a.action === "email" ? "✉" : a.action === "callback" ? "＋" : "💬"}</span>
            <span className="f-txt"><b>{a.company}</b> — {a.note}</span>
            <span className="meta">{new Date(a.ts).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ drawer */

function LeadDrawer({ l, onClose, onCall, onSent, onStatus, busy }: any) {
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
                <button className="btn" onClick={() => onCall(l)} disabled={l.dnc || !l.phone}>{PhoneIcon}Log a call</button>
                <button className="btn" disabled={busy} onClick={() => onStatus(l, "Replied")}>Replied</button>
                <button className="btn ghost" disabled={busy} onClick={() => onStatus(l, "No")}>Not interested</button>
              </div>
            </>
          )}

          {tab === "details" && (
            <div className="detail-body">
              <div className="poc-name"><Copyable text={l.contact_name || ""}>{l.contact_name || "—"}</Copyable></div>
              <div className="poc-title">{l.contact_title || ""}</div>
              <div className="poc-phone">
                {l.phone ? <Copyable text={l.phone}>{l.phone}</Copyable> : <span className="meta">No phone number yet</span>}
              </div>
              <div className="facts">
                <Fact k="Email" v={<Copyable text={l.email || ""}>{l.email || "—"}</Copyable>} />
                <Fact k="Confidence" v={l.email_confidence || "—"} />
                <Fact k="Website" v={l.website || "—"} />
                <Fact k="Job post" v={l.job_url ? <a href={l.job_url} target="_blank" rel="noreferrer">Open posting</a> : "—"} />
                <Fact k="Source" v={l.source || "—"} />
                <Fact k="Sprint" v={l.sprint_name || "—"} />
                <Fact k="Variant" v={(l.gen_subject || "").match(/\/mo|\/month/) ? "C · price-first" : (l.ab_variant || "—")} />
              </div>
            </div>
          )}

          {tab === "calls" && (
            <div className="stack">
              {!l.call_count && <div className="empty">No calls logged yet.</div>}
              {!!l.call_count && <div className="meta">{l.call_count} of {MAX_CALL_ATTEMPTS} attempts · last {l.last_call_at ? new Date(l.last_call_at).toLocaleDateString() : "—"}</div>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="f"><span className="k">{k}</span><span className="v">{v}</span></div>;
}

/* -------------------------------------------------------- log-call modal */

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
            <div className="meta">{[l.contact_name, l.contact_title].filter(Boolean).join(", ")}</div>
          </div>
          <button className="iconbtn" onClick={onClose}>{CloseIcon}</button>
        </div>

        <div className="modal-bd">
          <Field label="Outcome">
            <div className="opts">
              {OUTCOMES.map((o) => (
                <button key={o} className={"opt" + (outcome === o ? " on" : "")} onClick={() => setOutcome(o)}>{o}</button>
              ))}
            </div>
          </Field>
          <Field label="Who you spoke to">
            <input className="inp" value={spoke} onChange={(e) => setSpoke(e.target.value)} placeholder={l.contact_name || "Name"} />
          </Field>
          <Field label="Interest">
            <div className="opts">
              {INTERESTS.map((o) => (
                <button key={o} className={"opt" + (interest === o ? " on" : "")} onClick={() => setInterest(o)}>{o}</button>
              ))}
            </div>
          </Field>
          <Field label="Objection">
            <select className="inp" value={objection} onChange={(e) => setObjection(e.target.value)}>
              <option value="">— none —</option>
              {OBJECTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Duration (minutes)">
            <input className="inp" type="number" min="0" value={mins} onChange={(e) => setMins(e.target.value)} />
          </Field>
          <Field label="Notes">
            <textarea className="inp ta" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field label="Next step">
            <input className="inp" value={next} onChange={(e) => setNext(e.target.value)} placeholder="e.g. send two profiles" />
          </Field>
          <Field label="Next step date">
            <input className="inp" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
          </Field>

          <div className="sep-h" />
          <Field label={`Schedule a callback — in ${l.company}'s local time`}>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="inp" type="date" value={cbDate} onChange={(e) => setCbDate(e.target.value)} />
              <input className="inp" type="time" value={cbTime} onChange={(e) => setCbTime(e.target.value)} />
            </div>
            {cbTime && l.tz_offset != null && (
              <div className="callback-note">
                That is {convertToMine(cbTime, l.tz_offset)} your time (COT).
              </div>
            )}
          </Field>
        </div>

        <div className="modal-ft">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          {cbDate && (
            <button className="btn" disabled={busy} onClick={() => onCallback(cbDate, cbTime)}>Save callback</button>
          )}
          <button
            className="btn primary" disabled={busy}
            onClick={() => onSave({
              outcome, spoke_to: spoke, interest, objection,
              duration_sec: mins ? Number(mins) * 60 : null,
              notes, next_step: next, next_step_date: nextDate || null,
            })}
          >Save call</button>
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="frow"><div className="k">{label}</div>{children}</div>;
}

/** Their clock -> ours (Bogotá). Never shows a raw offset. */
function convertToMine(hhmm: string, tz: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const shift = -5 - tz;
  const x = ((h + shift) % 24 + 24) % 24;
  return `${String(x).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
