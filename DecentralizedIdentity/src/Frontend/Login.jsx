import React, { useState, useEffect } from "react";
// eslint-disable-next-line no-unused-vars
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import useFaceRecognition from "./hooks/useFaceRecognition";
import { getWalletConnection, getReadContract } from "../utils/contract";
import { fetchJSONFromCID } from "../utils/ipfs";
import { decryptWithWalletKey } from "../utils/crypto";
import { recordLoginOnChain, flushLoginQueue } from "../utils/recordLoginOnChain";
import { logAnomalyOnChain } from "../utils/logAnomalyOnChain";

// Stricter than 0.6 — face-api recommends 0.5 to reduce false accepts
const FACE_DISTANCE_THRESHOLD = 0.5;
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

      setStatus("👁 Please blink to confirm liveness...");
      setSubStatus("Look at the camera and blink naturally");
      const live = await detectLiveness({ timeout: 8000 });
      if (!live) {
        return fail(
          "❌ Liveness check failed",
          "Liveness failed — no blink detected",
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
      // Prevents someone from pointing to another user's CID
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

  const emojiMap = { neutral: "😐", happy: "😄", angry: "😠" };
  const emojiVariants = {
    neutral: { scale: 1 },
    happy:   { scale: [1, 1.3, 1], transition: { duration: 0.5 } },
    angry:   { rotate: [0, -12, 12, -8, 8, 0], transition: { duration: 0.7 } },
  };

  const locked = attempts >= MAX_ATTEMPTS && !faceReady;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-purple-100 via-blue-50 to-green-100 p-6">
      <h1 className="text-4xl font-bold mb-2 text-indigo-700">Secure Face Login 🔐</h1>
      <p className="text-gray-500 mb-6 text-sm">Your face is your key — no password needed</p>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        width="480"
        height="360"
        className="rounded-2xl shadow-lg mb-4 border-4 border-indigo-300 bg-black"
        style={{ maxWidth: "100%" }}
      />

      <motion.div
        key={emojiState}
        className="text-7xl mb-4 select-none"
        variants={emojiVariants}
        animate={emojiState}
      >
        {emojiMap[emojiState]}
      </motion.div>

      {/* Attempt dots */}
      {attempts > 0 && !faceReady && (
        <div className="flex items-center gap-1 mb-4">
          {Array.from({ length: MAX_ATTEMPTS }).map((_, i) => (
            <div
              key={i}
              className={`w-3 h-3 rounded-full ${i < attempts ? "bg-red-500" : "bg-gray-300"}`}
            />
          ))}
          <span className="text-xs text-gray-500 ml-2">{attempts}/{MAX_ATTEMPTS} attempts</span>
        </div>
      )}

      {/* Buttons */}
      <div className="flex flex-wrap gap-3 justify-center">
        {!faceReady && !locked && (
          <button
            onClick={handleDetectFace}
            disabled={busy}
            className="bg-indigo-600 text-white px-6 py-3 rounded-xl shadow hover:bg-indigo-700 transition-transform transform hover:scale-105 disabled:opacity-60 disabled:cursor-wait"
          >
            {busy ? "Verifying..." : "Detect & Verify"}
          </button>
        )}

        {faceReady && (
          <button
            onClick={() => navigate("/dashboard")}
            className="bg-green-600 text-white px-6 py-3 rounded-xl animate-pulse shadow hover:bg-green-700"
          >
            Continue to Dashboard ➡️
          </button>
        )}

        {locked && (
          <>
            <button
              onClick={handleRetry}
              className="bg-yellow-500 text-white px-6 py-3 rounded-xl shadow hover:bg-yellow-600"
            >
              Reset &amp; Retry
            </button>
            <button
              onClick={() => navigate("/email-otp")}
              className="bg-blue-600 text-white px-6 py-3 rounded-xl shadow hover:bg-blue-700"
            >
              Try Email OTP instead
            </button>
          </>
        )}
      </div>

      {/* Status */}
      <div className="mt-5 text-center max-w-sm">
        <p className="font-semibold text-gray-800">{status}</p>
        {subStatus && <p className="text-sm text-gray-500 mt-1">{subStatus}</p>}
      </div>
    </div>
  );
}
