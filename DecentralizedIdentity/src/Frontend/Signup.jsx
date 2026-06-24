import React, { useState } from "react";
import { keccak256, toUtf8Bytes } from "ethers";
import { uploadJSON } from "../utils/ipfs";
import { encryptWithWalletKey } from "../utils/crypto";
import { getWalletConnection, getReadContract } from "../utils/contract";
import useFaceRecognition from "./hooks/useFaceRecognition";

export default function Signup() {
  const { videoRef, startCamera, stopCamera, detectLiveness, captureFace, modelReady } =
    useFaceRecognition();
  const [status, setStatus] = useState("");
  const [form, setForm] = useState({ name: "", email: "" });
  const [busy, setBusy] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSignup = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!window.ethereum) { setStatus("❌ MetaMask not detected."); return; }
      if (!form.name || !form.email) { setStatus("⚠️ Please enter your name and email."); return; }
      if (!modelReady) { setStatus("⏳ Face models still loading, please wait..."); return; }

      // Single wallet connection — uses cache if already connected
      setStatus("🔑 Connecting to wallet...");
      const { address, contract } = await getWalletConnection();

      // Read-only check — no MetaMask popup
      setStatus("🔍 Checking existing registration...");
      const readContract = getReadContract();
      const alreadyRegistered = await readContract.isRegistered(address);
      if (alreadyRegistered) {
        setStatus("⚠️ Already registered. Please login instead.");
        return;
      }

      // Camera + liveness
      setStatus("🎥 Starting camera...");
      await startCamera();
      await new Promise((r) => setTimeout(r, 1000));

      setStatus("👁 Detecting liveness — please blink or look naturally...");
      const live = await detectLiveness({ timeout: 6000 });
      if (!live) {
        setStatus("❌ Liveness detection failed. Try again.");
        stopCamera();
        return;
      }

      setStatus("📸 Capturing face...");
      const descriptor = await captureFace();
      if (!descriptor) {
        setStatus("❌ Face capture failed. Try again.");
        stopCamera();
        return;
      }
      stopCamera();

      // Encrypt — encryptWithWalletKey reuses cached AES key (no extra popup)
      setStatus("🔐 Encrypting face data...");
      const faceHash = keccak256(toUtf8Bytes(descriptor.join(",")));
      const encrypted = await encryptWithWalletKey({
        faceDescriptor: Array.from(descriptor),
        walletAddress: address,
        name: form.name,
        email: form.email,
        faceHash,
        createdAt: new Date().toISOString(),
      });

      if (!encrypted?.ciphertext) {
        setStatus("❌ Encryption failed.");
        return;
      }

      // IPFS upload
      setStatus("🛰 Uploading encrypted identity to IPFS...");
      const cid = await uploadJSON(encrypted);
      if (!cid) { setStatus("❌ IPFS upload failed."); return; }

      // On-chain registration — uses cached signer from getWalletConnection
      setStatus("⛓ Storing identity on blockchain...");
      const tx = await contract.registerUser(form.name, form.email, cid);
      await tx.wait();

      setStatus("✅ Registration successful! You can now login.");
    } catch (err) {
      console.error(err);
      setStatus("❌ Error: " + err.message);
    } finally {
      stopCamera();
      setBusy(false);
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
    } else if (statusText.includes("⚠️")) {
      type = "warning";
      icon = "🔔";
      title = "Input Warning";
    } else if (statusText.includes("⏳") || statusText.includes("loading")) {
      type = "loading";
      icon = "🌀";
      title = "Model Initialization";
    } else if (statusText.includes("🎥") || statusText.includes("👁") || statusText.includes("📸")) {
      type = "loading";
      icon = "📷";
      title = "Biometrics Scanner";
    } else if (statusText.includes("🔑") || statusText.includes("🔐")) {
      type = "loading";
      icon = "🔑";
      title = "Securing Identity";
    } else if (statusText.includes("🔍")) {
      type = "loading";
      icon = "🔍";
      title = "Checking Records";
    } else if (statusText.includes("🛰") || statusText.includes("⛓")) {
      type = "loading";
      icon = "🔗";
      title = "Blockchain Registry";
    }

    // Strip emoji for a cleaner text presentation
    const cleanMsg = statusText.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, '').trim();

    return (
      <div className={`cyber-status-card status-${type}`}>
        <span className="status-icon">{icon}</span>
        <div className="status-content">
          <span className="status-title">{title}</span>
          <span className="status-message">{cleanMsg}</span>
        </div>
      </div>
    );
  };

  return (
    <>
      <h1>Create Identity</h1>
      <p className="subtitle">Secure face-registration linked directly to the blockchain</p>

      <div className="video-scanner-wrapper">
        <div className="scan-line"></div>
        <div className="scanner-corner corner-tl"></div>
        <div className="scanner-corner corner-tr"></div>
        <div className="scanner-corner corner-bl"></div>
        <div className="scanner-corner corner-br"></div>
        <div className="scanner-status-ring"></div>
        <video ref={videoRef} autoPlay playsInline muted />
      </div>

      <div className="cyber-input-group">
        <input
          type="text"
          name="name"
          placeholder="Full Name"
          value={form.name}
          onChange={handleChange}
          className="cyber-input"
          required
        />
      </div>

      <div className="cyber-input-group">
        <input
          type="email"
          name="email"
          placeholder="Email Address"
          value={form.email}
          onChange={handleChange}
          className="cyber-input"
          required
        />
      </div>

      <button
        onClick={handleSignup}
        disabled={busy}
        className="btn-cyber"
      >
        {busy ? "Registering..." : "Register Identity"}
      </button>

      {renderStatusCard(status)}
    </>
  );
}
