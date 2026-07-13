"use client";
import { signIn } from "next-auth/react";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function SignInInner() {
  const params = useSearchParams();
  const urlError = params.get("error");
  const [passcode, setPasscode] = useState("");
  const [showPasscode, setShowPasscode] = useState(false);
  const [error, setError] = useState(urlError === "CredentialsSignin" ? "wrong" : "");
  const [busy, setBusy] = useState(false);

  async function submitPasscode(e: React.FormEvent) {
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
      <div style={{
        width: "100%", maxWidth: 380, background: "#151922", border: "1px solid #232a37",
        borderRadius: 16, padding: 32, textAlign: "center",
      }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.3 }}>Nearwork · Leads</div>
        <div style={{ color: "#9aa4b6", fontSize: 14, marginTop: 8, marginBottom: 24 }}>
          Sign in with your <b>Nearwork Microsoft</b> account to continue.
        </div>

        <button
          onClick={() => signIn("azure-ad", { callbackUrl: "/" })}
          style={{
            width: "100%", padding: "12px 16px", borderRadius: 10, border: "none",
            background: "#fff", color: "#111", fontWeight: 600, fontSize: 15, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#F25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
            <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
          </svg>
          Sign in with Microsoft
        </button>

        <div style={{ color: "#5f6a7d", fontSize: 12, marginTop: 20 }}>
          Access is restricted to the Nearwork team.
        </div>

        {/* Temporary passcode fallback while we finish the Microsoft switch */}
        <div style={{ borderTop: "1px solid #232a37", marginTop: 24, paddingTop: 16 }}>
          {!showPasscode ? (
            <button
              onClick={() => setShowPasscode(true)}
              style={{ background: "none", border: "none", color: "#5f6a7d", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
            >
              Use team passcode instead
            </button>
          ) : (
            <form onSubmit={submitPasscode}>
              {error === "wrong" && (
                <div style={{
                  background: "#3a1b1b", border: "1px solid #5b2a2a", color: "#ffb4b4",
                  borderRadius: 10, padding: "8px 10px", fontSize: 13, marginBottom: 12,
                }}>
                  Incorrect passcode.
                </div>
              )}
              <input
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Team passcode"
                autoFocus
                style={{
                  width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #2c3444",
                  background: "#0f131b", color: "#e8ebf2", fontSize: 14, marginBottom: 10, boxSizing: "border-box",
                }}
              />
              <button
                type="submit"
                disabled={busy || !passcode}
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: 10, border: "none",
                  background: busy || !passcode ? "#1c6b5a" : "#12866E", color: "#fff",
                  fontWeight: 600, fontSize: 14, cursor: busy || !passcode ? "default" : "pointer",
                }}
              >
                {busy ? "Checking…" : "Enter"}
              </button>
            </form>
          )}
        </div>
      </div>
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
