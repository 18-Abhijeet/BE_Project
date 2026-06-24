import React, { useEffect, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import { getContract, getReadContract } from "../utils/contract";
import { useNavigate } from "react-router-dom";

export default function Dashboard() {
  const [confidence, setConfidence] = useState(0);
  const [loginHistory, setLoginHistory] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [userData, setUserData] = useState(null);
  const [revoking, setRevoking] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Read user from localStorage — confidence now lives here
  const user = JSON.parse(localStorage.getItem("user") || "null");

  useEffect(() => {
    if (!user?.account) {
      navigate("/");
      return;
    }

    (async () => {
      try {
        const readContract = getReadContract();

        // Verify the session is still valid on-chain before showing anything
        const isRegistered = await readContract.isRegistered(user.account);
        if (!isRegistered) {
          alert("Session invalid — please login again.");
          localStorage.clear();
          navigate("/");
          return;
        }

        const [history, anomalyData, details] = await Promise.all([
          readContract.getLoginHistory(user.account),
          readContract.getAllAnomalies(),
          readContract.getUser(user.account),
        ]);

        setLoginHistory(
          [...history]
            .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
            .map((h) => ({
              confidence: Number(h.confidence),
              timestamp: new Date(Number(h.timestamp) * 1000).toLocaleString(),
            }))
        );

        setAnomalies(
          anomalyData
            .filter((a) => a.user.toLowerCase() === user.account.toLowerCase())
            .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
            .map((a) => ({
              confidence: Number(a.confidence),
              reason: a.reason,
              timestamp: new Date(Number(a.timestamp) * 1000).toLocaleString(),
            }))
        );

        setUserData({
          name: details[0],
          email: details[1],
          active: details[4],
          registeredAt: new Date(Number(details[5]) * 1000).toLocaleString(),
          lastUpdated: new Date(Number(details[6]) * 1000).toLocaleString(),
        });

        const c = parseFloat(user.confidence);
        setConfidence(isNaN(c) ? 0 : Math.min(100, Math.max(0, c)));
      } catch (err) {
        console.error("Dashboard load error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.account]);

  const handleLogout = () => {
    localStorage.clear();
    navigate("/");
  };

  const handleRevoke = async () => {
    if (!window.ethereum) return;
    if (!window.confirm("Are you sure you want to revoke your identity? This cannot be undone.")) return;
    try {
      setRevoking(true);
      const contract = await getContract();
      const tx = await contract.revokeUser();
      await tx.wait();
      setUserData((prev) => ({ ...prev, active: false }));
      alert("Identity revoked. You will be logged out.");
      handleLogout();
    } catch (err) {
      alert("Failed to revoke: " + err.message);
    } finally {
      setRevoking(false);
    }
  };

  const pieData = [
    { name: "Match Quality", value: confidence },
    { name: "Deviation", value: Math.max(0, 100 - confidence) },
  ];
  
  // Cyberpunk Palette
  const COLORS = ["#06b6d4", "rgba(255, 255, 255, 0.05)"];

  const confidenceColor =
    confidence >= 80 ? "text-emerald-400" :
    confidence >= 60 ? "text-amber-400" :
    "text-rose-500";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0b10] text-[#f8fafc]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mx-auto mb-4" />
          <p className="text-slate-400 font-medium">Decrypting Vault...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0b10] text-[#f8fafc] p-4 md:p-8 relative">
      {/* Background Decorative Glows */}
      <div className="absolute top-0 left-0 w-full h-full bg-grid pointer-events-none opacity-20" />
      <div className="absolute top-10 left-10 w-72 h-72 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-96 h-96 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="text-center mb-10 relative z-10">
        <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-white to-cyan-300 drop-shadow-sm font-display tracking-tight">
          Decentralized Identity Vault
        </h1>
        <p className="text-slate-400 mt-2 text-md">On-chain identity credentials and biometric activity logs</p>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10 relative z-10">
        {/* User Details */}
        {userData && (
          <div className="bg-[#0f121e]/45 backdrop-blur-2xl p-6 md:p-8 rounded-2xl shadow-2xl border border-white/5 hover:border-white/10 transition-all duration-300 flex flex-col justify-between">
            <div>
              <h2 className="text-2xl font-bold mb-6 text-indigo-300 flex items-center gap-3 font-display">
                <span>👤</span> Credentials Record
              </h2>
              <div className="space-y-4 text-sm md:text-base">
                {[
                  ["Name", userData.name],
                  ["Email", userData.email],
                  ["Registered At", userData.registeredAt],
                  ["Last Updated", userData.lastUpdated],
                ].map(([label, value]) => (
                  <div key={label} className="flex flex-col sm:flex-row sm:justify-between gap-1 border-b border-white/5 pb-2">
                    <span className="font-semibold text-slate-400">{label}:</span>
                    <span className="text-slate-200 font-medium">{value}</span>
                  </div>
                ))}

                <div className="flex flex-col sm:flex-row sm:justify-between gap-1 border-b border-white/5 pb-2">
                  <span className="font-semibold text-slate-400">Wallet:</span>
                  <span className="font-mono text-xs bg-black/40 border border-white/5 px-2 py-1 rounded-lg text-slate-300 break-all">
                    {user.account}
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row sm:justify-between gap-1 border-b border-white/5 pb-2">
                  <span className="font-semibold text-slate-400">Status:</span>
                  <span className={`font-semibold ${userData.active ? "text-emerald-400" : "text-rose-500"}`}>
                    {userData.active ? "● ACTIVE" : "● REVOKED"}
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row sm:justify-between gap-1 pb-2">
                  <span className="font-semibold text-slate-400">Scan Match Confidence:</span>
                  <span className={`font-bold ${confidenceColor}`}>{confidence.toFixed(1)}%</span>
                </div>
              </div>
            </div>

            {userData.active && (
              <button
                onClick={handleRevoke}
                disabled={revoking}
                className="mt-8 w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white rounded-xl font-bold shadow-lg hover:shadow-rose-600/10 transform hover:scale-[1.02] active:scale-[1.0] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {revoking ? "Revoking Vault..." : "Revoke Identity Credentials 🔒"}
              </button>
            )}
          </div>
        )}

        {/* Pie Chart */}
        <div className="bg-[#0f121e]/45 backdrop-blur-2xl p-6 md:p-8 rounded-2xl shadow-2xl border border-white/5 hover:border-white/10 transition-all duration-300 flex flex-col items-center justify-center">
          <h2 className="text-2xl font-bold mb-2 text-indigo-300 flex items-center gap-3 font-display">
            <span>📊</span> Match Quality Analyzer
          </h2>
          <p className="text-sm text-slate-400 mb-6">Metrics from most recent facial verification</p>

          <div className="relative">
            <PieChart width={280} height={280}>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={70}
                outerRadius={100}
                dataKey="value"
                startAngle={90}
                endAngle={-270}
              >
                {pieData.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ background: '#0a0b10', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px' }}
                itemStyle={{ color: '#f8fafc' }}
                formatter={(v) => `${Number(v).toFixed(1)}%`} 
              />
              <Legend />
            </PieChart>
            <div className="absolute top-[48%] left-[50%] -translate-x-[50%] -translate-y-[50%] flex flex-col items-center">
              <span className="text-3xl font-extrabold text-slate-100">{confidence.toFixed(0)}%</span>
              <span className="text-[10px] tracking-widest text-slate-400 uppercase font-semibold mt-0.5">MATCH</span>
            </div>
          </div>

          <div className={`mt-6 px-5 py-2 rounded-full text-xs font-semibold uppercase tracking-wider ${
            confidence >= 80 ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
            confidence >= 60 ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
            "bg-rose-500/10 text-rose-400 border border-rose-500/20"
          }`}>
            {confidence >= 80 ? "🛡️ Secure Verification State" :
             confidence >= 60 ? "⚠️ Marginal Verification State" :
             "🚨 Warning: Compromised Identity State"}
          </div>
        </div>
      </div>

      {/* Login History */}
      <div className="bg-[#0f121e]/45 backdrop-blur-2xl p-6 md:p-8 rounded-2xl shadow-2xl border border-white/5 hover:border-white/10 transition-all duration-300 mb-8 relative z-10">
        <h2 className="text-2xl font-bold mb-6 text-indigo-300 flex items-center gap-3 font-display">
          <span>📅</span> Biometric Authentication Log
          <span className="text-xs font-normal text-slate-400 bg-white/5 px-3 py-1 rounded-full">{loginHistory.length} logs stored on-chain</span>
        </h2>
        {loginHistory.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm text-left">
              <thead>
                <tr className="border-b border-white/5 text-slate-400 uppercase tracking-widest text-[11px] font-bold">
                  <th className="pb-3 pl-3">Record ID</th>
                  <th className="pb-3">Timestamp</th>
                  <th className="pb-3">Vector Match Score</th>
                  <th className="pb-3">Access Result</th>
                </tr>
              </thead>
              <tbody>
                {loginHistory.map((log, i) => (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="py-4 pl-3 font-mono text-slate-500">#{loginHistory.length - i}</td>
                    <td className="py-4 text-slate-200">{log.timestamp}</td>
                    <td className="py-4 font-mono font-semibold text-emerald-400">
                      {log.confidence.toFixed(1)}%
                    </td>
                    <td className="py-4">
                      <span className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                        log.confidence >= 80 ? "bg-emerald-500/10 text-emerald-400" :
                        log.confidence >= 60 ? "bg-amber-500/10 text-amber-400" :
                        "bg-rose-500/10 text-rose-400"
                      }`}>
                        {log.confidence >= 80 ? "Success" : log.confidence >= 60 ? "Admitted" : "Warning"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-slate-500 text-center py-8">No authentication logs found on-chain.</p>
        )}
      </div>

      {/* Anomaly Logs */}
      <div className="bg-[#0f121e]/45 backdrop-blur-2xl p-6 md:p-8 rounded-2xl shadow-2xl border border-white/5 hover:border-white/10 transition-all duration-300 mb-10 relative z-10">
        <h2 className="text-2xl font-bold mb-6 text-rose-400 flex items-center gap-3 font-display">
          <span>🚨</span> Intrusion Detection Alerts
          {anomalies.length > 0 && (
            <span className="bg-rose-500/20 text-rose-400 text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wider">
              {anomalies.length} alerts logged
            </span>
          )}
        </h2>
        {anomalies.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm text-left">
              <thead>
                <tr className="border-b border-white/5 text-slate-400 uppercase tracking-widest text-[11px] font-bold">
                  <th className="pb-3 pl-3">Timestamp</th>
                  <th className="pb-3">Logged Confidence</th>
                  <th className="pb-3">Incident Description</th>
                </tr>
              </thead>
              <tbody>
                {anomalies.map((a, i) => (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="py-4 pl-3 text-slate-200">{a.timestamp}</td>
                    <td className="py-4 font-mono font-semibold text-rose-400">
                      {a.confidence.toFixed(1)}%
                    </td>
                    <td className="py-4 text-slate-300">{a.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-emerald-400 text-center py-8 font-medium bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
            ✓ No anomalous access attempts or vector discrepancies detected.
          </p>
        )}
      </div>

      {/* Logout */}
      <div className="text-center relative z-10 mt-8">
        <button
          onClick={handleLogout}
          className="px-8 py-3 bg-transparent border border-white/10 hover:border-white/30 text-slate-300 hover:text-white rounded-xl font-bold transition-all duration-200 transform hover:scale-[1.02] active:scale-[1.0]"
        >
          Close Session 🚪
        </button>
      </div>
    </div>
  );
}
