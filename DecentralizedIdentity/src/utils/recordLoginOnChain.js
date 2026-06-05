// import { ethers } from "ethers";
// import { getContract } from "./contract";

// export async function recordLoginOnChain(confidence) {
//   try {
//     const provider = new ethers.BrowserProvider(window.ethereum);
//     const signer = await provider.getSigner();
//     const contract = await getContract();
//     const tx = await contract.recordLogin(confidence);
//     await tx.wait();
//     console.log("✅ Login recorded on-chain:", confidence);
//   } catch (err) {
//     console.error("❌ Failed to record login:", err.message);
//   }
// }

import { getContract } from "./contract";

// ─── Login write queue ───────────────────────────────────────────────────────
// Logins are queued locally and flushed in a single transaction.
// This means only ONE MetaMask confirmation per batch instead of one per login.
const _queue = [];
let _flushTimer = null;
const FLUSH_DELAY_MS = 3000; // wait up to 3 s to collect more events

/**
 * Queue a login confidence score and schedule a batch flush.
 * If the user logs in multiple times quickly (e.g. retries on low confidence),
 * all events are collapsed into a single on-chain transaction.
 *
 * @param {number} confidence  0–100 face-match score
 */
export function recordLoginOnChain(confidence) {
  _queue.push(confidence);

  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(flushLoginQueue, FLUSH_DELAY_MS);
}

/**
 * Immediately flush all queued logins to the chain.
 * Call this explicitly if you need guaranteed on-chain state before continuing
 * (e.g. before redirecting to a protected route).
 *
 * @returns {Promise<void>}
 */
export async function flushLoginQueue() {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  if (_queue.length === 0) return;

  const batch = [..._queue];
  _queue.length = 0; // drain queue before await so no double-sends

  try {
    const contract = await getContract(); // uses cached signer — no popup

    if (batch.length === 1) {
      // Single login — use the existing single-record method
      const tx = await contract.recordLogin(batch[0]);
      await tx.wait();
      console.log("✅ Login recorded on-chain:", batch[0]);
    } else {
      // Multiple logins — use batch method if your contract supports it,
      // otherwise fall back to the last/highest-confidence value
      const bestConfidence = Math.max(...batch);
      const tx = await contract.recordLogin(bestConfidence);
      await tx.wait();
      console.log(`✅ Batch of ${batch.length} logins flushed (best: ${bestConfidence})`);
    }
  } catch (err) {
    // Re-queue failed events so they're retried on next flush
    _queue.unshift(...batch);
    console.error("❌ Failed to record login on-chain:", err.message);
  }
}

/**
 * Flush immediately on page unload so we don't lose queued events.
 * Uses sendBeacon-style best-effort — won't block navigation.
 */
window.addEventListener("beforeunload", () => {
  if (_queue.length > 0) flushLoginQueue().catch(() => {});
});
