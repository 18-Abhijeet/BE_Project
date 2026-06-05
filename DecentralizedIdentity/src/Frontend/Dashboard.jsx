import React, { useEffect, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
// eslint-disable-next-line no-unused-vars
import { getContract, getReadContract, getWalletConnection } from "../utils/contract";
import { useNavigate } from "react-router-dom";

export default function Dashboard() {
  const [confidence, setConfidence] = useState(0);
  const [loginHistory, setLoginHistory] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [userData, setUserData] = useState(null);
  const [revoking, setRevoking] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Read user from localStorage — confidence now lives here (not a separate key)
  const user = JSON.parse(localStorage.getItem("user") || "null");

  useEffect(() => {
    if (!user?.account) {
      navigate("/");
      return;
    }

    (async () => {
      try {
        // All reads use JsonRpcProvider — zero MetaMask popups
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
            .sort((a, b) => Number(b.timestamp) - Number(a.timestamp)) // newest first
            .map((h) => ({
              confidence: Number(h.confidence),
              timestamp: new Date(Number(h.timestamp) * 1000).toLocaleString(),
            }))
        );

        // Filter anomalies to this wallet only
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

        // ✅ Confidence comes from the user session object (set by Login.jsx)
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
      const contract = await getContract(); // cached signer — no new popup
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
    { name: "Matched", value: confidence },
    { name: "Remaining", value: Math.max(0, 100 - confidence) },
  ];
  const COLORS = ["#4CAF50", "#E0E0E0"];

  // Confidence badge color
  const confidenceColor =
    confidence >= 80 ? "text-green-600" :
    confidence >= 60 ? "text-yellow-500" :
    "text-red-500";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4" />
          <p className="text-gray-600 font-medium">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 p-4 md:p-8">
      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 drop-shadow-sm">
          Dashboard
        </h1>
        <p className="text-gray-600 mt-2 text-lg">Manage your identity and monitor activity</p>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">

        {/* User Details */}
        {userData && (
          <div className="bg-white/90 backdrop-blur-md p-6 md:p-8 rounded-2xl shadow-xl border border-gray-200 hover:shadow-2xl transition-all duration-300">
            <h2 className="text-2xl font-bold mb-6 text-gray-800 flex items-center gap-2">
              👤 User Details
            </h2>
            <div className="space-y-4 text-sm md:text-base">
              {[
                ["Name", userData.name],
                ["Email", userData.email],
                ["Registered At", userData.registeredAt],
                ["Last Updated", userData.lastUpdated],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col sm:flex-row sm:justify-between gap-1">
                  <span className="font-semibold text-blue-600">{label}:</span>
                  <span className="text-gray-700">{value}</span>
                </div>
              ))}

              <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                <span className="font-semibold text-blue-600">Wallet:</span>
                <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded-lg text-gray-700 break-all">
                  {user.account}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                <span className="font-semibold text-blue-600">Status:</span>
                <span className={`font-semibold ${userData.active ? "text-green-600" : "text-red-600"}`}>
                  {userData.active ? "✅ Active" : "❌ Revoked"}
                </span>
              </div>

              {/* Last login confidence inline */}
              <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                <span className="font-semibold text-blue-600">Last Login Confidence:</span>
                <span className={`font-bold ${confidenceColor}`}>{confidence.toFixed(1)}%</span>
              </div>
            </div>

            {userData.active && (
              <button
                onClick={handleRevoke}
                disabled={revoking}
                className="mt-6 w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white rounded-lg font-semibold shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {revoking ? "Revoking..." : "Revoke Identity 🔒"}
              </button>
            )}
          </div>
        )}

        {/* Pie Chart */}
        <div className="bg-white/90 backdrop-blur-md p-6 md:p-8 rounded-2xl shadow-xl border border-gray-200 hover:shadow-2xl transition-all duration-300 flex flex-col items-center">
          <h2 className="text-2xl font-bold mb-2 text-gray-800 flex items-center gap-2">
            📊 Face Match Confidence
          </h2>
          <p className="text-sm text-gray-500 mb-4">Score from most recent login</p>

          <PieChart width={280} height={280}>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              innerRadius={65}
              outerRadius={105}
              dataKey="value"
              startAngle={90}
              endAngle={-270}
              label={({ name, value }) => `${name}: ${value.toFixed(1)}%`}
            >
              {pieData.map((_, index) => (
                <Cell key={index} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
            <Legend />
          </PieChart>

          {/* Confidence interpretation */}
          <div className={`mt-3 px-4 py-2 rounded-full text-sm font-semibold ${
            confidence >= 80 ? "bg-green-100 text-green-700" :
            confidence >= 60 ? "bg-yellow-100 text-yellow-700" :
            "bg-red-100 text-red-700"
          }`}>
            {confidence >= 80 ? "🟢 High confidence match" :
             confidence >= 60 ? "🟡 Medium confidence — monitor" :
             "🔴 Low confidence — review recommended"}
          </div>
        </div>
      </div>

      {/* Login History */}
      <div className="bg-white/90 backdrop-blur-md p-6 md:p-8 rounded-2xl shadow-xl border border-gray-200 mb-8">
        <h2 className="text-2xl font-bold mb-6 text-gray-800 flex items-center gap-2">
          📅 Login History
          <span className="ml-2 text-sm font-normal text-gray-500">({loginHistory.length} records)</span>
        </h2>
        {loginHistory.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse rounded-lg overflow-hidden shadow-sm text-sm">
              <thead className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white">
                <tr>
                  <th className="p-3 text-left">#</th>
                  <th className="p-3 text-left">Date &amp; Time</th>
                  <th className="p-3 text-left">Confidence (%)</th>
                  <th className="p-3 text-left">Result</th>
                </tr>
              </thead>
              <tbody>
                {loginHistory.map((log, i) => (
                  <tr key={i} className={`hover:bg-gray-50 transition-colors ${i % 2 === 0 ? "" : "bg-gray-50/50"}`}>
                    <td className="border-b border-gray-200 p-3 text-gray-500">{i + 1}</td>
                    <td className="border-b border-gray-200 p-3">{log.timestamp}</td>
                    <td className="border-b border-gray-200 p-3 font-semibold text-green-600">
                      {log.confidence.toFixed(1)}%
                    </td>
                    <td className="border-b border-gray-200 p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        log.confidence >= 80 ? "bg-green-100 text-green-700" :
                        log.confidence >= 60 ? "bg-yellow-100 text-yellow-700" :
                        "bg-red-100 text-red-700"
                      }`}>
                        {log.confidence >= 80 ? "High" : log.confidence >= 60 ? "Medium" : "Low"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8">No login history found.</p>
        )}
      </div>

      {/* Anomaly Logs */}
      <div className="bg-white/90 backdrop-blur-md p-6 md:p-8 rounded-2xl shadow-xl border border-gray-200 mb-8">
        <h2 className="text-2xl font-bold mb-6 text-red-600 flex items-center gap-2">
          ⚠️ Anomaly Logs
          {anomalies.length > 0 && (
            <span className="ml-2 bg-red-100 text-red-600 text-sm px-2 py-0.5 rounded-full font-medium">
              {anomalies.length} alerts
            </span>
          )}
        </h2>
        {anomalies.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse rounded-lg overflow-hidden shadow-sm text-sm">
              <thead className="bg-gradient-to-r from-red-500 to-pink-500 text-white">
                <tr>
                  <th className="p-3 text-left">Date &amp; Time</th>
                  <th className="p-3 text-left">Confidence (%)</th>
                  <th className="p-3 text-left">Reason</th>
                </tr>
              </thead>
              <tbody>
                {anomalies.map((a, i) => (
                  <tr key={i} className={`hover:bg-gray-50 transition-colors ${i % 2 === 0 ? "" : "bg-gray-50/50"}`}>
                    <td className="border-b border-gray-200 p-3">{a.timestamp}</td>
                    <td className="border-b border-gray-200 p-3 font-semibold text-red-600">
                      {a.confidence.toFixed(1)}%
                    </td>
                    <td className="border-b border-gray-200 p-3">{a.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8 text-green-600 font-medium">
            ✅ No anomalies detected — your account is secure.
          </p>
        )}
      </div>

      {/* Logout */}
      <div className="text-center">
        <button
          onClick={handleLogout}
          className="px-8 py-3 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white rounded-lg font-semibold shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200"
        >
          Logout 🚪
        </button>
      </div>
    </div>
  );
}
