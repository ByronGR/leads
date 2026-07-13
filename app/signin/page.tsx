"use client";
import { signIn } from "next-auth/react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function SignInInner() {
  const params = useSearchParams();
  const error = params.get("error");
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

        {error && (
          <div style={{
            background: "#3a1b1b", border: "1px solid #5b2a2a", color: "#ffb4b4",
            borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 16,
          }}>
            Couldn’t sign you in. Use your <b>@nearwork.co</b> Microsoft account and try again.
          </div>
        )}

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
