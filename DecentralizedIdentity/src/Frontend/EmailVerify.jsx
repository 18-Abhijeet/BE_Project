import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth } from "../utils/firebase";
import { signInWithEmailLink, isSignInWithEmailLink } from "firebase/auth";

export default function EmailVerify() {
  const [status, setStatus] = useState("Verifying...");
  const navigate = useNavigate();

  useEffect(() => {
    const verifyEmailLink = async () => {
      try {
        if (isSignInWithEmailLink(auth, window.location.href)) {
          let email = window.localStorage.getItem("emailForSignIn");
          if (!email) {
            email = window.prompt("Please enter your email for verification");
          }
          await signInWithEmailLink(auth, email, window.location.href);

          window.localStorage.removeItem("emailForSignIn");

          // Save minimal session
          localStorage.setItem(
            "user",
            JSON.stringify({ email, verifiedVia: "email-link" })
          );
          setStatus("✅ Email verified successfully! Redirecting...");
          setTimeout(() => navigate("/dashboard"), 1500);
        } else {
          setStatus("❌ Invalid or expired verification link.");
        }
      } catch (err) {
        console.error(err);
        setStatus("❌ Error: " + err.message);
      }
    };
    verifyEmailLink();
  }, [navigate]);

  const renderStatusCard = (statusText) => {
    let type = "loading";
    let icon = "⚡";
    let title = "System Update";

    if (statusText.includes("✅")) {
      type = "success";
      icon = "🛡️";
      title = "Verification Success";
    } else if (statusText.includes("❌")) {
      type = "error";
      icon = "⚠️";
      title = "Verification Failed";
    } else if (statusText.includes("Verifying")) {
      type = "loading";
      icon = "🌀";
      title = "Authenticating Session";
    }

    const cleanMsg = statusText.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, '').trim();

    return (
      <div className={`cyber-status-card status-${type}`} style={{ width: '100%', margin: '0' }}>
        <span className="status-icon">{icon}</span>
        <div className="status-content">
          <span className="status-title">{title}</span>
          <span className="status-message">{cleanMsg}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="auth-container">
      <div className="auth-card" style={{ maxWidth: '400px', height: 'auto', padding: '40px', flexDirection: 'column', alignItems: 'center' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.2rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '8px', letterSpacing: '-0.025em', background: 'linear-gradient(135deg, #ffffff 40%, #c7d2fe 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', textAlign: 'center' }}>
          Identity Verification
        </h1>
        <p className="subtitle" style={{ textAlign: 'center', marginBottom: '24px', color: 'var(--text-muted)' }}>Confirming credentials with decentralized registry</p>
        
        {renderStatusCard(status)}
      </div>
    </div>
  );
}
