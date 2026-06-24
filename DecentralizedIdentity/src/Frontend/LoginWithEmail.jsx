import React, { useState } from "react";
import { sendSignInLinkToEmail } from "firebase/auth";
import { auth } from "../utils/firebase";
import { getReadContract } from "../utils/contract";

export default function LoginWithEmail() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  const handleSendLink = async (e) => {
    e.preventDefault();
    setStatus("");
    setSending(true);

    try {
      // ✅ Step 1: Get contract instance
      const contract = await getReadContract();

      // ✅ Step 2: Loop through all registered users to check email existence
      let found = false;

      // Try each of first 20 addresses from connected provider
      for (let i = 0; i < 20; i++) {
        try {
          const address = await window.ethereum.request({
            method: "eth_accounts",
          });
          const userData = await contract.getUser(address[0]);
          if (
            userData.email &&
            userData.email.toLowerCase() === email.toLowerCase()
          ) {
            found = true;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!found) {
        setStatus("❌ Email not found in blockchain registry. Please sign up first.");
        setSending(false);
        return;
      }

      // ✅ Step 3: Prepare Firebase action settings
      const actionCodeSettings = {
        url: "http://localhost:5173/email-verify", // or your prod URL
        handleCodeInApp: true,
      };

      // ✅ Step 4: Send email sign-in link
      await sendSignInLinkToEmail(auth, email, actionCodeSettings);
      window.localStorage.setItem("emailForSignIn", email);
      setStatus("✅ Sign-in link sent to your email. Please check your inbox!");
    } catch (err) {
      console.error("Error sending link:", err);
      setStatus("❌ Error: " + err.message);
    } finally {
      setSending(false);
    }
  };

  const renderStatusCard = (statusText) => {
    if (!statusText) return null;

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
    } else if (statusText.includes("⏳") || statusText.includes("loading")) {
      type = "loading";
      icon = "🌀";
      title = "Initializing Link";
    }

    const cleanMsg = statusText.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, '').trim();

    return (
      <div className={`cyber-status-card status-${type}`} style={{ width: '100%', margin: '16px 0 0 0' }}>
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
      <div className="auth-card" style={{ maxWidth: '440px', height: 'auto', padding: '40px', flexDirection: 'column', alignItems: 'center' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.2rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '8px', letterSpacing: '-0.025em', background: 'linear-gradient(135deg, #ffffff 40%, #c7d2fe 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', textAlign: 'center' }}>
          Login via Email
        </h1>
        <p className="subtitle" style={{ textAlign: 'center', marginBottom: '24px', color: 'var(--text-muted)' }}>Verify your identity via registered email link</p>

        <form
          onSubmit={handleSendLink}
          style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}
        >
          <div className="cyber-input-group" style={{ marginBottom: '0' }}>
            <input
              type="email"
              placeholder="Enter your registered email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="cyber-input"
            />
          </div>

          <button
            type="submit"
            disabled={sending}
            className="btn-cyber btn-cyan"
          >
            {sending ? "Sending..." : "Send Sign-In Link"}
          </button>
        </form>

        {status && renderStatusCard(status)}
      </div>
    </div>
  );
}
