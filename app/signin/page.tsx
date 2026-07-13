"use client";
import { signIn } from "next-auth/react";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function SignInInner() {
  const params = useSearchParams();
  const urlError = params.get("error");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState(urlError === "CredentialsSignin" ? "wrong" : "");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await signIn("credentials", { passcode, redirect: false, callbackUrl: "/" });
    setBusy(false);
    if (res?.ok) {
      window.location.href = "/";
    } else {
      setError("wrong");
    }
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0b0d12", color: "#e8ebf2", fontFamily: "system-ui, sans-serif", padding: 24,
    }}>
      <form onSubmit={submit} style={{
        width: "100%", maxWidth: 380, background: "#151922", border: "1px solid #232a37",
        borderRadius: 16, padding: 32, textAlign: "center",
      }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.3 }}>Nearwork · Leads</div>
        <div style={{ color: "#9aa4b6", fontSize: 14, marginTop: 8, marginBottom: 24 }}>
          Enter the team passcode to continue.
        </div>
        {error === "wrong" && (
          <div style={{
            background: "#3a1b1b", border: "1px solid #5b2a2a", color: "#ffb4b4",
            borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 16,
          }}>
            Incorrect passcode. Try again.
          </div>
        )}
        <input
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="Passcode"
          autoFocus
          style={{
            width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #2c3444",
            background: "#0f131b", color: "#e8ebf2", fontSize: 15, marginBottom: 14, boxSizing: "border-box",
          }}
        />
        <button
          type="submit"
          disabled={busy || !passcode}
          style={{
            width: "100%", padding: "12px 16px", borderRadius: 10, border: "none",
            background: busy || !passcode ? "#1c6b5a" : "#12866E", color: "#fff",
            fontWeight: 600, fontSize: 15, cursor: busy || !passcode ? "default" : "pointer",
          }}
        >
          {busy ? "Checking…" : "Enter"}
        </button>
        <div style={{ color: "#5f6a7d", fontSize: 12, marginTop: 20 }}>
          Access is restricted to the Nearwork team.
        </div>
      </form>
    </div>
  );
}

export default function SignIn() {
  return (
    <Suspense fallback={null}>
      <SignInInner />
    </Suspense>
  );
}
