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

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSignup = async () => {
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

      setStatus("👁 Detecting liveness — please blink...");
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
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-6">
      <h1 className="text-3xl font-bold mb-4 text-purple-700">Signup</h1>

      <video ref={videoRef} autoPlay muted className="w-80 h-60 border rounded mb-3 shadow-lg" />

      <input
        type="text"
        name="name"
        placeholder="Full Name"
        onChange={handleChange}
        className="border p-2 rounded mb-2 w-64"
      />
      <input
        type="email"
        name="email"
        placeholder="Email"
        onChange={handleChange}
        className="border p-2 rounded mb-3 w-64"
      />

      <button
        onClick={handleSignup}
        className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded shadow-md transition"
      >
        Register Identity
      </button>

      <p className="mt-3 text-sm font-semibold text-gray-800">{status}</p>
    </div>
  );
}
