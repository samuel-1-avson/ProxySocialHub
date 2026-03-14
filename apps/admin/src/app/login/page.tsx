"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { login, isAuthenticated } from "@/lib/auth";
import { Shield, Eye, EyeOff, AlertCircle, Loader2 } from "lucide-react";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [lockCountdown, setLockCountdown] = useState("");

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated()) router.replace("/dashboard");
  }, [router]);

  // Restore lockout from sessionStorage
  useEffect(() => {
    const stored = sessionStorage.getItem("admin_lockout");
    if (stored) {
      const until = parseInt(stored, 10);
      if (until > Date.now()) {
        setLockedUntil(until);
        setAttempts(MAX_ATTEMPTS);
      } else {
        sessionStorage.removeItem("admin_lockout");
      }
    }
  }, []);

  // Countdown timer
  useEffect(() => {
    if (!lockedUntil) return;
    const interval = setInterval(() => {
      const remaining = lockedUntil - Date.now();
      if (remaining <= 0) {
        setLockedUntil(null);
        setAttempts(0);
        sessionStorage.removeItem("admin_lockout");
        setLockCountdown("");
        clearInterval(interval);
      } else {
        const m = Math.floor(remaining / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        setLockCountdown(`${m}:${s.toString().padStart(2, "0")}`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lockedUntil]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockedUntil) return;

    setError("");
    setLoading(true);

    try {
      const identity = await login(username, password);

      // Set a cookie so Next.js middleware can detect auth
      const maxAge = 4 * 60 * 60; // 4 hours in seconds
      document.cookie = `admin_token=1; Max-Age=${maxAge}; path=/; SameSite=Strict`;

      // Reset attempts on success
      setAttempts(0);
      sessionStorage.removeItem("admin_lockout");

      console.info(`Admin login: ${identity.username} (${identity.role})`);
      router.replace("/dashboard");
    } catch (err: unknown) {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);

      if (newAttempts >= MAX_ATTEMPTS) {
        const until = Date.now() + LOCKOUT_MS;
        setLockedUntil(until);
        sessionStorage.setItem("admin_lockout", String(until));
        setError("Too many failed attempts. Access locked for 15 minutes.");
      } else {
        const remaining = MAX_ATTEMPTS - newAttempts;
        setError(
          err instanceof Error ? err.message : "Invalid credentials"
        );
        if (remaining <= 2) {
          setError((prev) => `${prev} (${remaining} attempt${remaining !== 1 ? "s" : ""} remaining)`);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const isLocked = !!lockedUntil;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f] p-4">
      {/* Background grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e1e2e_1px,transparent_1px),linear-gradient(to_bottom,#1e1e2e_1px,transparent_1px)] bg-[size:40px_40px] opacity-40 pointer-events-none" />

      <div className="relative w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 mb-4">
            <Shield className="w-8 h-8 text-indigo-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">ProxyHub Admin</h1>
          <p className="text-sm text-[#94a3b8] mt-1">Restricted access — authorized personnel only</p>
        </div>

        {/* Card */}
        <div className="bg-[#111118] border border-[#1e1e2e] rounded-2xl p-8 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Username */}
            <div>
              <label className="block text-sm font-medium text-[#94a3b8] mb-1.5">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                disabled={loading || isLocked}
                required
                className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-4 py-2.5 text-white placeholder-[#4a4a6a] focus:outline-none focus:border-indigo-500 disabled:opacity-50 transition-colors"
                placeholder="Enter username"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-[#94a3b8] mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={loading || isLocked}
                  required
                  className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-4 py-2.5 pr-11 text-white placeholder-[#4a4a6a] focus:outline-none focus:border-indigo-500 disabled:opacity-50 transition-colors"
                  placeholder="Enter password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4a4a6a] hover:text-[#94a3b8] transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Lockout countdown */}
            {isLocked && lockCountdown && (
              <div className="text-center text-sm text-[#94a3b8]">
                Retry in <span className="font-mono text-amber-400">{lockCountdown}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || isLocked || !username || !password}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/40 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Authenticating…
                </>
              ) : (
                "Sign In"
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-[#4a4a6a] mt-6">
          ProxyHub v1.0 · Admin Panel · All access is logged and audited
        </p>
      </div>
    </div>
  );
}
