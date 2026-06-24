import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import useFaceRecognition from "./hooks/useFaceRecognition";
import { getWalletConnection, getReadContract } from "../utils/contract";
import { fetchJSONFromCID } from "../utils/ipfs";
import { decryptWithWalletKey } from "../utils/crypto";
import { recordLoginOnChain, flushLoginQueue } from "../utils/recordLoginOnChain";
import { logAnomalyOnChain } from "../utils/logAnomalyOnChain";

// Stricter than 0.7 — face-api recommends 0.6 to balance false accepts and false rejects
const FACE_DISTANCE_THRESHOLD = 0.6;
const MAX_ATTEMPTS = 3;

const euclideanDistance = (a, b) =>
  Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));

export default function Login() {
  const { videoRef, startCamera, stopCamera, detectLiveness, captureFace, modelReady } =
    useFaceRecognition();

  const [status, setStatus]         = useState("");
  const [subStatus, setSubStatus]   = useState("");
  const [faceReady, setFaceReady]   = useState(false);
  const [attempts, setAttempts]     = useState(0);
  const [emojiState, setEmojiState] = useState("neutral");
  const [account, setAccount]       = useState(null);
  const [busy, setBusy]             = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const init = async () => {
      try {
        if (!window.ethereum) { setStatus("❌ MetaMask not detected"); return; }
        const { address } = await getWalletConnection();
        setAccount(address);
        setStatus("✅ Wallet connected");
        setSubStatus(address.slice(0, 6) + "..." + address.slice(-4));
      } catch {
        setStatus("❌ Wallet connection failed");
      }
    };
    init();
    return () => stopCamera();
  }, []);

  // Centralised failure handler
  const fail = async (msg, anomalyReason, detail = "") => {
    setStatus(msg);
    setSubStatus(detail);
    setEmojiState("angry");
    setAttempts((a) => a + 1);
    await logAnomalyOnChain(0, anomalyReason);
    stopCamera();
    setBusy(false);
  };

  const handleDetectFace = async () => {
    if (busy) return;
    setBusy(true);
    setEmojiState("neutral");

    try {
      if (!account) return fail("❌ Wallet not connected", "No wallet");
      if (!modelReady) {
        setStatus("⏳ Face models loading — please wait...");
        setBusy(false);
        return;
      }

      // ── 1. Registration check (read-only, no popup) ───────────────────────
      setStatus("⛓ Checking registration...");
      setSubStatus("");
      const readContract = getReadContract();
      const isRegistered = await readContract.isRegistered(account);
      if (!isRegistered) {
        return fail(
          "❌ Not registered",
          "Unregistered wallet attempted login",
          "Please sign up first."
        );
      }

      const userData = await readContract.getUser(account);
      const [name, email, cid, , active] = userData;
      if (!active) {
        return fail(
          "⚠️ Identity revoked",
          "Revoked identity login attempt",
          "Contact support or re-register."
        );
      }

      // ── 2. Camera + blink liveness ────────────────────────────────────────
      setStatus("🎥 Starting camera...");
      await startCamera();
      await new Promise((r) => setTimeout(r, 1200));

      setStatus("👁 Please blink or look naturally to confirm liveness...");
      setSubStatus("Authenticating unique biometric signature");
      const live = await detectLiveness({ timeout: 6000 });
      if (!live) {
        return fail(
          "❌ Liveness check failed",
          "Liveness failed — verification timeout",
          "Try again in good lighting with your face clearly visible."
        );
      }

      // ── 3. Capture live face embedding ────────────────────────────────────
      setStatus("📸 Capturing face...");
      setSubStatus("");
      const liveDescriptor = await captureFace();
      stopCamera();

      // ── 4. Fetch + decrypt registered identity (single IPFS call) ─────────
      setStatus("🔐 Fetching registered identity...");
      const encrypted = await fetchJSONFromCID(cid);
      // Uses cached AES key — no extra MetaMask popup
      const decrypted = await decryptWithWalletKey(encrypted);

      // ── Security A: descriptor must exist and be an array ─────────────────
      if (!decrypted?.faceDescriptor || !Array.isArray(decrypted.faceDescriptor)) {
        return fail(
          "❌ Corrupted identity data",
          "Missing or invalid face descriptor",
          "Please re-register."
        );
      }

      // ── Security B: dimension match (face-api always outputs 128D) ─────────
      if (decrypted.faceDescriptor.length !== liveDescriptor.length) {
        return fail(
          "❌ Face model version mismatch",
          "Descriptor dimension mismatch",
          "Please re-register with the current model."
        );
      }

      // ── Security C: wallet embedded in IPFS must match the connected signer ─
      if (decrypted.walletAddress?.toLowerCase() !== account.toLowerCase()) {
        return fail(
          "❌ Identity-wallet binding failed",
          "CID wallet mismatch — possible tampering",
          "Encrypted data does not belong to this wallet."
        );
      }

      // ── 5. Face matching ──────────────────────────────────────────────────
      setStatus("🧠 Comparing face vectors...");
      const storedDescriptor = decrypted.faceDescriptor.map(Number);
      const distance   = euclideanDistance(storedDescriptor, liveDescriptor);
      const confidence = Number((Math.max(0, 1 - distance) * 100).toFixed(2));

      console.debug(`[Login] distance=${distance.toFixed(4)} confidence=${confidence}%`);

      if (distance > FACE_DISTANCE_THRESHOLD) {
        // Log with the actual confidence so admins can review borderline cases
        await logAnomalyOnChain(confidence, "Face mismatch");
        setAttempts((a) => a + 1);
        setEmojiState("angry");
        setStatus(`❌ Face not recognized (${confidence.toFixed(1)}% match)`);
        setSubStatus(
          distance > 0.8
            ? "Very different face — unauthorized attempt logged"
            : "Below threshold — try better lighting or angle"
        );
        setBusy(false);
        return;
      }

      // ── 6. Success ────────────────────────────────────────────────────────
      setEmojiState("happy");
      setStatus(`✅ Identity verified — welcome, ${name}!`);
      setSubStatus(`${confidence.toFixed(1)}% confidence match`);

      // confidence lives inside the user object — Dashboard reads it from here
      localStorage.setItem("user", JSON.stringify({
        name, email, account, cid, confidence,
        verifiedAt: new Date().toISOString(),
      }));

      recordLoginOnChain(confidence);
      await flushLoginQueue(); // flush before navigating so tx isn't lost

      setFaceReady(true);
      setBusy(false);
    } catch (err) {
      console.error("[Login] unexpected error:", err);
      setStatus("❌ Unexpected error");
      setSubStatus(err.message);
      setEmojiState("angry");
      await logAnomalyOnChain(0, "Login exception: " + err.message.slice(0, 60));
      setAttempts((a) => a + 1);
      stopCamera();
      setBusy(false);
    }
  };

  const handleRetry = () => {
    setAttempts(0);
    setStatus("✅ Wallet connected");
    setSubStatus(account ? account.slice(0, 6) + "..." + account.slice(-4) : "");
    setEmojiState("neutral");
    setFaceReady(false);
    setBusy(false);
  };

  const renderScannerStatus = () => {
    if (emojiState === "happy") {
      return (
        <div className="flex flex-col items-center justify-center p-3 text-emerald-400">
          <span className="text-4xl animate-bounce">🔓</span>
          <span className="text-xs uppercase tracking-widest text-emerald-400 font-bold mt-2">ACCESS GRANTED</span>
        </div>
      );
    }
    if (emojiState === "angry") {
      return (
        <div className="flex flex-col items-center justify-center p-3 text-red-500">
          <span className="text-4xl animate-shake">🚫</span>
          <span className="text-xs uppercase tracking-widest text-red-500 font-bold mt-2">ACCESS DENIED</span>
        </div>
      );
    }
    if (busy) {
      return (
        <div className="flex flex-col items-center justify-center p-3 text-cyan-400">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-cyan-400 mb-2"></div>
          <span className="text-xs uppercase tracking-widest text-cyan-400 font-bold">ANALYZE BIOMETRIC</span>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center p-3 text-indigo-400">
        <span className="text-4xl animate-pulse">🔒</span>
        <span className="text-xs uppercase tracking-widest text-indigo-400 font-bold mt-2">SECURE PORTAL</span>
      </div>
    );
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
    } else if (statusText.includes("⚠️")) {
      type = "warning";
      icon = "🔔";
      title = "System Alert";
    } else if (statusText.includes("⏳") || statusText.includes("loading")) {
      type = "loading";
      icon = "🌀";
      title = "Biometrics Scanner";
    } else if (statusText.includes("🎥") || statusText.includes("👁") || statusText.includes("📸")) {
      type = "loading";
      icon = "📷";
      title = "Analyzing Face";
    } else if (statusText.includes("🔑") || statusText.includes("🔐")) {
      type = "loading";
      icon = "🔑";
      title = "Decrypting Records";
    } else if (statusText.includes("🔍")) {
      type = "loading";
      icon = "🔍";
      title = "Registry Query";
    } else if (statusText.includes("🛰") || statusText.includes("⛓")) {
      type = "loading";
      icon = "🔗";
      title = "Blockchain Log";
    }

    const cleanMsg = statusText.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, '').trim();

    return (
      <div className={`cyber-status-card status-${type}`}>
        <span className="status-icon">{icon}</span>
        <div className="status-content">
          <span className="status-title">{title}</span>
          <span className="status-message">{cleanMsg}</span>
          {subStatus && <span className="status-sub-message text-xs opacity-80 mt-1">{subStatus}</span>}
        </div>
      </div>
    );
  };

  const locked = attempts >= MAX_ATTEMPTS && !faceReady;

  return (
    <>
      <h1>Secure Login</h1>
      <p className="subtitle">Authenticate securely via high-speed on-chain face recognition</p>

      <div className="video-scanner-wrapper">
        <div className="scan-line"></div>
        <div className="scanner-corner corner-tl"></div>
        <div className="scanner-corner corner-tr"></div>
        <div className="scanner-corner corner-bl"></div>
        <div className="scanner-corner corner-br"></div>
        <div className="scanner-status-ring"></div>
        <video ref={videoRef} autoPlay playsInline muted />
      </div>

      <div className="my-2 flex justify-center">
        {renderScannerStatus()}
      </div>

      {/* Attempt dots */}
      {attempts > 0 && !faceReady && (
        <div className="attempt-dots">
          {Array.from({ length: MAX_ATTEMPTS }).map((_, i) => (
            <div
              key={i}
              className={`attempt-dot ${i < attempts ? "active" : ""}`}
            />
          ))}
        </div>
      )}

      {/* Buttons */}
      <div className="flex flex-col gap-3 w-full">
        {!faceReady && !locked && (
          <button
            onClick={handleDetectFace}
            disabled={busy}
            className="btn-cyber btn-cyan"
          >
            {busy ? "Authenticating..." : "Detect & Verify"}
          </button>
        )}

        {faceReady && (
          <button
            onClick={() => navigate("/dashboard")}
            className="btn-cyber btn-success text-center"
          >
            Continue to Dashboard ➡️
          </button>
        )}

        {locked && (
          <div className="flex gap-2 w-full">
            <button
              onClick={handleRetry}
              className="btn-cyber btn-warning flex-1"
            >
              Retry Scan
            </button>
            <button
              onClick={() => navigate("/email-otp")}
              className="btn-cyber btn-outline flex-1 text-center"
            >
              Email OTP
            </button>
          </div>
        )}
      </div>

      {renderStatusCard(status)}
    </>
  );
}
