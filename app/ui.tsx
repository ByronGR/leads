"use client";
import React, { useState } from "react";
import { Lead, repColor, statusLabel, norm, zoneChip, theirTime, windowHere, callWindow, schedule, nextStep, actionFor } from "@/lib/cadence";
import { messageFor } from "@/lib/copy";

/* ------------------------------------------------------------------ icons */
const I = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
export const PhoneIcon = I("M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.68 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.32 1.85.55 2.81.68A2 2 0 0 1 22 16.92z");
export const MailIcon = I("M4 4h16v16H4z M22 6l-10 7L2 6");
export const CloseIcon = I("M18 6L6 18M6 6l12 12");
export const RefreshIcon = I("M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15");

/* ------------------------------------------------------- shared primitives */

export function OwnerDot({ name }: { name?: string | null }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <span className="owner-dot" style={{ background: repColor(name) }} title={name || "Unassigned"}>
      {initial}
    </span>
  );
}

export function StageBadge({ l }: { l: Lead }) {
  const s = norm(l.status);
  const cls = s === "New" ? "b-New" : s === "Replied" ? "b-Replied" : s === "No" ? "b-No" : "b-Sent";
  const extra = s === "Sent" && l.sent_count > 0 ? ` · touch ${l.sent_count}` : "";
  return <span className={"badge " + cls}>{statusLabel(l.status)}{extra}</span>;
}

/** Four dots — one per email in the Variant C sequence plus the final. */
export function TouchDots({ l }: { l: Lead }) {
  return (
    <span className="dots" title={`${l.sent_count} of 3 emails sent`}>
      {[1, 2, 3].map((n) => (
        <i key={n} className={l.sent_count >= n ? "on" : ""} />
      ))}
    </span>
  );
}

/** Everything identifying copies on click. Teal "Copied ✓" for 1.3s. */
export function Copyable({ text, children, className = "" }:
  { text: string; children: React.ReactNode; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <span
      className={"copyable " + className + (done ? " copied" : "")}
      title="Click to copy"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1300);
        }).catch(() => {});
      }}
    >
      {done ? "✓ Copied" : children}
    </span>
  );
}

export function ZoneCell({ l }: { l: Lead }) {
  const z = zoneChip(l);
  const t = theirTime(l);
  const w = callWindow(l);
  const win = windowHere(l);
  return (
    <div className="tzcell">
      <div className="tzrow">
        {z && <span className="zone">{z}</span>}
        {t && <span className="hs">{t}</span>}
        <span className={"win-tag " + w.state}>{w.label}</span>
      </div>
      {win && <div className="meta">{win}</div>}
    </div>
  );
}

/** The email to send RIGHT NOW — generated per touch, not the stored first touch. */
export function EmailPanel({ l }: { l: Lead }) {
  const [all, setAll] = useState(false);
  const msg = messageFor(l);
  if (msg.note) return <div className="note-box">{msg.note}</div>;
  return (
    <div className="composer">
      <div className="panel-h">
        <span className="t">Next email · {msg.label}</span>
        <button className="btn sm" onClick={() => {
          navigator.clipboard?.writeText(`${msg.subject}\n\n${msg.body}`).then(() => {
            setAll(true); setTimeout(() => setAll(false), 1300);
          }).catch(() => {});
        }}>{all ? "Copied \u2713" : "Copy all"}</button>
      </div>
      <div className="field">
        <div className="k"><span>To</span></div>
        <Copyable text={l.email || ""} className="copyrow">{l.email || "no email yet"}</Copyable>
      </div>
      <div className="field">
        <div className="k"><span>Subject</span></div>
        <Copyable text={msg.subject} className="copyrow">{msg.subject}</Copyable>
      </div>
      <div className="field">
        <div className="k"><span>Message</span></div>
        <Copyable text={msg.body} className="body">{msg.body}</Copyable>
      </div>
    </div>
  );
}

/** The cadence as dated steps. Visible, never editable — only a callback moves. */
export function SchedulePanel({ l }: { l: Lead }) {
  const steps = schedule(l);
  const today = new Date();
  return (
    <div className="panel" style={{ padding: "14px 16px", marginBottom: 14 }}>
      <div className="panel-h">
        <span className="t">Outreach schedule</span>
        <span style={{ fontSize: 11.5, color: "var(--tx-3)", fontWeight: 600 }}>
          {steps.filter((s) => s.done).length}/{steps.length} done
        </span>
      </div>
      <div className="sched">
        {steps.map((s, i) => {
          const state = s.done ? "done" : s.due <= today ? "due" : "upcoming";
          return (
            <div className={"sstep " + state} key={i}>
              <span className="pip" />
              <span>
                <span className="st">{s.label}</span>
                <span className="sk">{s.kind}</span>
              </span>
              <span className="sd">
                {s.done ? "done" : s.due.toLocaleDateString([], { month: "short", day: "numeric" })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ActionBadge({ l }: { l: Lead }) {
  const a = actionFor(l);
  if (!a) return <span className="meta">waiting</span>;
  if (a.kind === "follow") return <span className={"badge f" + a.level}>{a.label}</span>;
  if (a.kind === "call") return <span className="badge b-Sent">{a.label}</span>;
  return <span className="badge b-New">{a.label}</span>;
}
