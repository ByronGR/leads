"use client";
import { signIn } from "next-auth/react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function SignInInner() {
  const params = useSearchParams();
  const error = params.get("error");
  const denied = error === "AccessDenied";
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
          Sign in with your <b>@nearwork.co</b> Google account to continue.
        </div>
        {denied && (
          <div style={{
            background: "#3a1b1b", border: "1px solid #5b2a2a", color: "#ffb4b4",
            borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 16,
          }}>
            That account isn’t a <b>@nearwork.co</b> address. Use your work Google account.
          </div>
        )}
        <button
          onClick={() => signIn("google", { callbackUrl: "/" })}
          style={{
            width: "100%", padding: "12px 16px", borderRadius: 10, border: "none",
            background: "#fff", color: "#111", fontWeight: 600, fontSize: 15, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.5 2.6 30.1 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.7 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.5c-.5 2.9-2.2 5.4-4.7 7l7.3 5.7c4.3-4 6.9-9.9 6.9-17.2z"/>
            <path fill="#FBBC05" d="M10.4 28.3c-.5-1.4-.8-2.9-.8-4.3s.3-3 .8-4.3l-7.8-6.1C1 16.9 0 20.3 0 24s1 7.1 2.6 10.4l7.8-6.1z"/>
            <path fill="#34A853" d="M24 48c6.1 0 11.3-2 15-5.5l-7.3-5.7c-2 1.4-4.7 2.3-7.7 2.3-6.3 0-11.7-3.7-13.6-9.3l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/>
          </svg>
          Sign in with Google
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
