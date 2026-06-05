// import { ethers } from "ethers";
// import { getContract } from "./contract";

// export async function logAnomalyOnChain(confidence, reason) {
//   try {
//     const provider = new ethers.BrowserProvider(window.ethereum);
//     // eslint-disable-next-line no-unused-vars
//     const signer = await provider.getSigner();
//     const contract = await getContract();
//     const tx = await contract.logAnomaly(confidence, reason);
//     await tx.wait();
//     console.log("✅ Anomaly logged:", confidence, reason);
//   } catch (err) {
//     console.error("❌ Failed to log anomaly:", err.message);
//   }
// }

// frontend/src/utils/logAnomalyOnChain.js
import { getContract } from "./contract";

/**
 * Log a security anomaly on-chain.
 * Uses the cached signer from getWalletConnection — no MetaMask popup.
 * Failures are non-fatal: logged to console only so they don't block the UI.
 *
 * @param {number} confidence  Face match score (0 = failure)
 * @param {string} reason      Human-readable anomaly description
 */
export async function logAnomalyOnChain(confidence, reason) {
  try {
    const contract = await getContract(); // cached — no new provider/signer
    const tx = await contract.logAnomaly(confidence, reason);
    await tx.wait();
    console.log("✅ Anomaly logged:", reason, `(confidence: ${confidence})`);
  } catch (err) {
    // Never throw — anomaly logging must not interrupt the login flow
    console.error("❌ Failed to log anomaly:", err.message);
  }
}
