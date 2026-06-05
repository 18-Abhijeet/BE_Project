// import { ethers } from "ethers";

// /**
//  * Derive AES key securely from the connected MetaMask wallet.
//  * The key is never stored — it’s regenerated every time from wallet signature.
//  */
// export async function deriveKeyFromWallet() {
//   if (!window.ethereum) throw new Error("MetaMask not detected");

//   const provider = new ethers.BrowserProvider(window.ethereum);
//   const signer = await provider.getSigner();

//   // Ask user to sign a constant message to derive deterministic key
//   const message = "Authorize biometric encryption key";
//   const signature = await signer.signMessage(message);

//   // Convert the signature to SHA-256 hash → 256-bit AES key
//   const encoder = new TextEncoder();
//   const data = encoder.encode(signature);
//   const hashBuffer = await crypto.subtle.digest("SHA-256", data);
//   const key = await crypto.subtle.importKey(
//     "raw",
//     hashBuffer,
//     { name: "AES-GCM" },
//     false,
//     ["encrypt", "decrypt"]
//   );
//   return key;
// }

// /**
//  * Encrypt JSON object using AES-GCM with random IV and salt.
//  */
// export async function encryptData(key, jsonData) {
//   const encoder = new TextEncoder();
//   const data = encoder.encode(JSON.stringify(jsonData));
//   const iv = crypto.getRandomValues(new Uint8Array(12));

//   const ciphertextBuffer = await crypto.subtle.encrypt(
//     { name: "AES-GCM", iv },
//     key,
//     data
//   );

//   // Convert to Base64 for easy IPFS storage
//   const ciphertext = btoa(String.fromCharCode(...new Uint8Array(ciphertextBuffer)));
//   const ivBase64 = btoa(String.fromCharCode(...iv));

//   return { iv: ivBase64, ciphertext };
// }

// /**
//  * Decrypt data from IPFS (AES-GCM)
//  */
// export async function decryptData(key, encrypted) {
//   try {
//     const iv = Uint8Array.from(atob(encrypted.iv), (c) => c.charCodeAt(0));
//     const ciphertext = Uint8Array.from(atob(encrypted.ciphertext), (c) => c.charCodeAt(0));

//     const decryptedBuffer = await crypto.subtle.decrypt(
//       { name: "AES-GCM", iv },
//       key,
//       ciphertext
//     );

//     const decoder = new TextDecoder();
//     const jsonText = decoder.decode(decryptedBuffer);
//     return JSON.parse(jsonText);
//   } catch (err) {
//     console.error("❌ Decryption failed:", err);
//     throw new Error("Corrupted or invalid IPFS data");
//   }
// }

// /**
//  * Generate random 32-byte verification key (for blockchain check)
//  */
// export function generateVerificationKey() {
//   return ethers.hexlify(ethers.randomBytes(32));
// }

// frontend/src/utils/crypto.js
import { ethers } from "ethers";
import { getWalletConnection } from "./contract";

// ─── Session key cache ───────────────────────────────────────────────────────
// The AES key is derived from a wallet signature. Signing is a MetaMask popup.
// We cache the derived key in memory for the duration of the page session so
// the user only sees the "Authorize biometric encryption key" popup ONCE.
let _sessionKey = null;

/**
 * Returns the AES-GCM key derived from the wallet signature.
 * Triggers a MetaMask signMessage popup only on the first call per session.
 * All subsequent calls return the in-memory cached key instantly.
 *
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKeyFromWallet() {
  if (_sessionKey) return _sessionKey;

  if (!window.ethereum) throw new Error("MetaMask not detected");

  // Reuse the cached signer from the wallet connection — no new popup
  const { signer } = await getWalletConnection();

  const message = "Authorize biometric encryption key";
  const signature = await signer.signMessage(message); // one popup per session

  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(signature));

  _sessionKey = await crypto.subtle.importKey(
    "raw",
    hashBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );

  // Clear key from memory on account switch / disconnect
  window.ethereum.on("accountsChanged", () => { _sessionKey = null; });

  return _sessionKey;
}

/**
 * Encrypt JSON object using AES-GCM with a random IV.
 *
 * @param {CryptoKey} key
 * @param {object}    jsonData
 * @returns {Promise<{ iv: string, ciphertext: string }>}
 */
export async function encryptData(key, jsonData) {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(jsonData));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertextBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);

  return {
    iv:         btoa(String.fromCharCode(...iv)),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertextBuffer))),
  };
}

/**
 * Decrypt AES-GCM encrypted data (from IPFS or storage).
 *
 * @param {CryptoKey} key
 * @param {{ iv: string, ciphertext: string }} encrypted
 * @returns {Promise<object>}
 */
export async function decryptData(key, encrypted) {
  try {
    const iv         = Uint8Array.from(atob(encrypted.iv),         (c) => c.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(encrypted.ciphertext), (c) => c.charCodeAt(0));

    const decryptedBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(decryptedBuffer));
  } catch (err) {
    console.error("❌ Decryption failed:", err);
    throw new Error("Corrupted or invalid encrypted data");
  }
}

/** Generate random 32-byte hex verification key (for blockchain checks). */
export function generateVerificationKey() {
  return ethers.hexlify(ethers.randomBytes(32));
}

/**
 * Convenience: derive key and encrypt in one call.
 * Avoids callers having to call deriveKeyFromWallet() separately.
 */
export async function encryptWithWalletKey(jsonData) {
  const key = await deriveKeyFromWallet();
  return encryptData(key, jsonData);
}

/**
 * Convenience: derive key and decrypt in one call.
 */
export async function decryptWithWalletKey(encrypted) {
  const key = await deriveKeyFromWallet();
  return decryptData(key, encrypted);
}
