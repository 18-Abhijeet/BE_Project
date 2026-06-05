// // frontend/src/utils/contract.js
// import { ethers } from "ethers";
// import UserRegistry from "../../artifacts/contracts/UserRegistry.sol/UserRegistry.json"


// const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3"



// /**
//  * Returns a contract instance connected to the signer
//  */
// export async function getContract() {
//   if (!window.ethereum) {
//     throw new Error("MetaMask not detected");
//   }

//   try {
//     const provider = new ethers.BrowserProvider(window.ethereum);   
//     await provider.send("eth_requestAccounts", []); // request accounts
//     const signer = await provider.getSigner();
//     const address = await signer.getAddress();
//     console.log("✅ Wallet connected:", address);
//     const contract = new ethers.Contract(CONTRACT_ADDRESS, UserRegistry.abi, signer);
//     return contract;
//   } catch (err) {
//     console.error("Failed to connect to contract:", err);
//     throw err;
//   }
// }
// export async function getReadContract() {
//   try {
//     // For local Hardhat network: default provider (e.g., localhost:8545)
//     // For Sepolia/testnet: you can also use Alchemy/Infura endpoint here.
//     const provider = new ethers.BrowserProvider(window.ethereum);
//     const contract = new ethers.Contract(CONTRACT_ADDRESS, UserRegistry.abi, provider);
//     return contract;
//   } catch (err) {
//     console.error("❌ Failed to create read-only contract:", err);
//     throw err;
//   }
// }
// /**
//  * Register user on-chain
//  */
// export async function registerUser(name, email, faceDescriptor) {
//   try {
//     const contract = await getContract();
//     const tx = await contract.registerUser(name, email, faceDescriptor);
//     await tx.wait();
//     console.log("User registered successfully:", name);
//   } catch (err) {
//     console.error("Register failed:", err);
//     throw err;
//   }
// }

// /**
//  * Fetch user from contract by address
//  */
// export async function getUser(address) {
//   try {
//     const contract = await getContract();
//     const user = await contract.getUser(address);
//     return user; // { name, email, faceHashOrIPFS, account }
//   } catch (err) {
//     console.error("Failed to fetch user:", err);
//     throw err;
//   }
// }

// frontend/src/utils/contract.js
import { ethers } from "ethers";
import UserRegistry from "../../artifacts/contracts/UserRegistry.sol/UserRegistry.json";

const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

// ─── Singleton cache — created once per page session ────────────────────────
let _cache = null; // { provider, signer, address, contract }

/**
 * Returns the cached wallet connection, requesting accounts only on first call.
 * All subsequent calls reuse the existing signer — zero MetaMask popups.
 */
export async function getWalletConnection() {
  if (_cache) return _cache;

  if (!window.ethereum) throw new Error("MetaMask not detected");

  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []); // only fires once
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const contract = new ethers.Contract(CONTRACT_ADDRESS, UserRegistry.abi, signer);

  console.log("✅ Wallet connected:", address);
  _cache = { provider, signer, address, contract };

  // Invalidate cache when the user switches account or disconnects
  window.ethereum.on("accountsChanged", () => { _cache = null; });
  window.ethereum.on("chainChanged",    () => { _cache = null; });

  return _cache;
}

/** Write-capable contract (uses cached signer). */
export async function getContract() {
  const { contract } = await getWalletConnection();
  return contract;
}

/**
 * Read-only contract — uses a plain JSON-RPC provider.
 * No MetaMask popup, no signer needed, much faster.
 */
export function getReadContract() {
  // Hardhat local — swap for Alchemy/Infura URL on testnet/mainnet
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  return new ethers.Contract(CONTRACT_ADDRESS, UserRegistry.abi, provider);
}

/** Register user on-chain. */
export async function registerUser(name, email, faceDescriptor) {
  const contract = await getContract();
  const tx = await contract.registerUser(name, email, faceDescriptor);
  await tx.wait();
  console.log("✅ User registered:", name);
}

/** Fetch user by address — uses read-only provider, no popup. */
export async function getUser(address) {
  const contract = getReadContract();   // synchronous, no await needed
  return contract.getUser(address);
}
