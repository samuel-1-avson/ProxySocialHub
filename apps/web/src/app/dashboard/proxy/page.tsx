"use client";

import { useClipboard } from "@/hooks/useClipboard";
import { DataError } from "@/components/workspace/Patterns";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createSessionIntent,
  getSessionIntentStatus,
  getSessions,
  getAnalyticsOverview,
} from "@/lib/api";
import type {
  Session,
  CreateSessionIntentResponse,
  SessionIntentLifecycle,
} from "@/lib/api";
import {
  Globe,
  Shield,
  Loader2,
  Copy,
  Terminal,
  Wifi,
  WifiOff,
  Activity,
  Zap,
  CheckCircle,
  RefreshCw,
  Settings,
  ExternalLink,
  Lock,
  Hexagon,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import { getBuyerProxyEndpoint } from "@/lib/proxy-endpoint";
import { authApiFetch } from "@/lib/api/client";

const PROXY_ENDPOINT = getBuyerProxyEndpoint();
const SDK_MATRIX = [
  {
    id: "python",
    name: "Python",
    icon: "Py",
    bg: "hover:bg-blue-500/10",
    install: "pip install proxyhubb",
    docs: "https://docs.proxyhubb.com/docs/sdks/python",
    registry: "https://pypi.org/project/proxyhubb/",
  },
  {
    id: "nodejs",
    name: "Node.js",
    icon: "JS",
    bg: "hover:bg-emerald-500/10",
    install: "npm install @proxyhubb/sdk",
    docs: "https://docs.proxyhubb.com/docs/sdks/nodejs",
    registry: "https://www.npmjs.com/package/@proxyhubb/sdk",
  },
  {
    id: "golang",
    name: "Golang",
    icon: "Go",
    bg: "hover:bg-cyan-500/10",
    install: "go get github.com/samuel-1-avson/ProxySocialHub/sdks/go@v0.2.0",
    docs: "https://docs.proxyhubb.com/docs/sdks/go",
    registry:
      "https://pkg.go.dev/github.com/samuel-1-avson/ProxySocialHub/sdks/go",
  },
  {
    id: "rest",
    name: "Rest API",
    icon: "API",
    bg: "hover:bg-primary/10",
    install: "GET https://api.proxyhubb.com/v1/sdks/languages",
    docs: "https://docs.proxyhubb.com/docs/api",
    registry: "https://docs.proxyhubb.com/openapi.yaml",
  },
] as const;
const terminalIntentStates = new Set<SessionIntentLifecycle>([
  "ledger_committed",
  "batched",
  "chain_committed",
  "archived",
  "expired",
]);

function formatIntentLifecycleLabel(state: SessionIntentLifecycle) {
  return state.replace(/_/g, " ");
}

function isTerminalIntentLifecycle(
  state: SessionIntentLifecycle | "idle" | "requesting",
) {
  return terminalIntentStates.has(state as SessionIntentLifecycle);
}

export default function ProxyPage() {
  const { copy: copyText, feedback: clipboardFeedback } = useClipboard();
  const [intentError, setIntentError] = useState("");
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState(false);
  // "api_reachable" only means the control API answered. Only "proxy_verified" means
  // traffic actually traversed the gateway with a session.
  const [connectionStatus, setConnectionStatus] = useState<
    "idle" | "testing" | "api_reachable" | "proxy_verified" | "proxy_failed" | "offline"
  >("idle");
  const [connectionDetail, setConnectionDetail] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<string>("any");
  const [createdIntent, setSessionIntent] =
    useState<CreateSessionIntentResponse | null>(null);
  const [requestedLifecycle, setIntentLifecycle] = useState<
    "idle" | "requesting" | SessionIntentLifecycle
  >("idle");
  const [sdkGuide, setSdkGuide] = useState<
    (typeof SDK_MATRIX)[number]["id"] | null
  >(null);

  const tiers = [
    {
      id: "any",
      name: "Any Tier",
      icon: Globe,
      color: "text-muted-foreground",
      border: "border-border",
      bg: "bg-muted",
    },
    {
      id: "Bronze",
      name: "Bronze",
      icon: Shield,
      color: "text-orange-400",
      border: "border-orange-500/20",
      bg: "bg-orange-500/10",
    },
    {
      id: "Silver",
      name: "Silver",
      icon: CheckCircle,
      color: "text-slate-300",
      border: "border-slate-500/20",
      bg: "bg-slate-500/10",
    },
    {
      id: "Gold",
      name: "Gold",
      icon: Zap,
      color: "text-amber-700 dark:text-amber-400",
      border: "border-amber-500/20",
      bg: "bg-amber-500/10",
    },
  ];

  const {
    data: allSessions = [],
    isLoading: loading,
    error: sessionsError,
    refetch: retrySessions,
  } = useQuery({
    queryKey: ["sessions"],
    queryFn: getSessions,
    refetchInterval: 15000,
    retry: 2,
  });

  const {
    data: analytics,
    isLoading: analyticsLoading,
    error: analyticsError,
    refetch: retryAnalytics,
  } = useQuery({
    queryKey: ["analytics-overview"],
    queryFn: getAnalyticsOverview,
    refetchInterval: 30000,
    retry: 2,
  });

  const { data: persistedIntentStatus } = useQuery({
    queryKey: ["session-intent-status", createdIntent?.intent.intent_id],
    queryFn: () => getSessionIntentStatus(createdIntent!.intent.intent_id),
    enabled: !!createdIntent?.intent.intent_id,
    refetchInterval: (query) =>
      createdIntent &&
      !isTerminalIntentLifecycle(
        query.state.data?.lifecycle_state ?? requestedLifecycle,
      )
        ? 5000
        : false,
    retry: 1,
  });

  const sessions = allSessions.filter((s: Session) => s.status === "active");

  async function handleQuickStart(type: "rotating" | "sticky") {
    setCreating(true);
    setIntentError("");
    setIntentLifecycle("requesting");
    try {
      const intent = await createSessionIntent({
        type,
        preferred_tier: selectedTier === "any" ? undefined : selectedTier,
      });
      setSessionIntent(intent);
      setIntentLifecycle(intent.lifecycle_state);

      if (intent.token) {
        const curlCmd = `curl -x session-intent:${encodeURIComponent(intent.token)}@${PROXY_ENDPOINT} https://httpbin.org/ip`;
        await copyText(curlCmd);
        setCopied("intent-curl");
        setTimeout(() => setCopied(null), 3000);
      }
    } catch (error) {
      setIntentError(
        error instanceof Error ? error.message : "Session request failed.",
      );
      setIntentLifecycle("idle");
    } finally {
      setCreating(false);
    }
  }

  const matchingStatus =
    persistedIntentStatus?.intent.intent_id === createdIntent?.intent.intent_id
      ? persistedIntentStatus
      : undefined;
  const sessionIntent = createdIntent
    ? {
        ...createdIntent,
        ...(matchingStatus
          ? {
              expires_at: matchingStatus.expires_at,
              lifecycle_state: matchingStatus.lifecycle_state,
              intent: { ...createdIntent.intent, ...matchingStatus.intent },
            }
          : {}),
      }
    : null;
  async function testConnection() {
    setTesting(true);
    setConnectionStatus("testing");
    setConnectionDetail("");
    try {
      // With a live session token, send real traffic through the gateway. Without one,
      // all we can honestly check is that the control API answers.
      const token = activeIntent?.token;
      const response = token
        ? await authApiFetch("/api/proxy/test", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          })
        : await fetch("/api/proxy/test");
      const body = (await response.json().catch(() => null)) as
        | { status?: string; message?: string }
        | null;
      setConnectionDetail(body?.message ?? "");
      if (body?.status === "proxy_verified") setConnectionStatus("proxy_verified");
      else if (body?.status === "proxy_failed") setConnectionStatus("proxy_failed");
      else if (response.ok && body?.status === "api_reachable") setConnectionStatus("api_reachable");
      else setConnectionStatus("offline");
    } catch {
      setConnectionStatus("offline");
      setConnectionDetail("The test could not be completed.");
    } finally {
      setTesting(false);
    }
  }

  function copyToClipboard(text: string, label: string) {
    void copyText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 3000);
  }

  const activeSession = sessions[0];
  const activeIntent =
    sessionIntent && !terminalIntentStates.has(sessionIntent.lifecycle_state)
      ? sessionIntent
      : null;
  const liveIdentifier = activeIntent
    ? activeIntent.intent.intent_id
    : (activeSession?.id ?? "");
  const liveProtocol = activeIntent
    ? activeIntent.intent.session_type.toUpperCase()
    : (activeSession?.type.toUpperCase() ?? "UNKNOWN");
  const liveCurlCopy = activeIntent
    ? `curl -x session-intent:${encodeURIComponent(activeIntent.token)}@${PROXY_ENDPOINT} https://httpbin.org/ip`
    : `curl -x user:pass@${PROXY_ENDPOINT} https://httpbin.org/ip`;
  const liveCurlDisplay = activeIntent
    ? `curl -x session-intent:<intent-token>@${PROXY_ENDPOINT} https://httpbin.org/ip`
    : `curl -x ${activeSession?.id.substring(0, 8) ?? "user"}:********@${PROXY_ENDPOINT} https://httpbin.org/ip`;
  const liveNodeCopy = activeIntent
    ? `const axios = require('axios');\nconst proxy = 'http://session-intent:${activeIntent.token}@${PROXY_ENDPOINT}';\naxios.get('https://httpbin.org/ip', { proxy }).then(res => console.log(res.data));`
    : `const axios = require('axios');\nconst proxy = 'http://user:pass@${PROXY_ENDPOINT}';\naxios.get('https://httpbin.org/ip', { proxy }).then(res => console.log(res.data));`;
  const liveNodeDisplay = activeIntent
    ? `const axios = require('axios');\nconst proxy = 'http://session-intent:<intent-token>@${PROXY_ENDPOINT}';\naxios.get('https://...', { proxy });`
    : `const axios = require('axios');\nconst proxy = 'http://${activeSession?.id.substring(0, 8) ?? "user"}:***@${PROXY_ENDPOINT}';\naxios.get('https://...', { proxy });`;

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 },
  };

  if (sessionsError || analyticsError)
    return (
      <div className="ui-page">
        <h1>Proxy gateway</h1>
        <DataError
          error={sessionsError || analyticsError}
          retry={() => {
            void retrySessions();
            void retryAnalytics();
          }}
        />
      </div>
    );
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-6">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="font-mono text-xs normal-case font-semibold tracking-normal text-muted-foreground animate-pulse">
          Initializing Proxy Core...
        </p>
      </div>
    );
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-10 pb-20"
    >
      {intentError && (
        <DataError
          title="Session request was not completed"
          error={new Error(intentError)}
        />
      )}
      {clipboardFeedback && (
        <p role="status" className="workflow-note">
          {clipboardFeedback}
        </p>
      )}
      {/* Header */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 border-b border-border pb-8"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-primary font-mono text-xs font-semibold normal-case tracking-normal">
            <Hexagon size={12} className="animate-spin-slow" /> Proxy session
            tools
          </div>
          <h1 className="text-4xl font-semibold font-mono normal-case tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400">
            Proxy Gateway
          </h1>
          <p className="text-muted-foreground font-mono text-xs max-w-lg normal-case tracking-tight">
            Review your gateway endpoint and request a session.
          </p>
        </div>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={testConnection}
          disabled={testing}
          className="flex items-center gap-3 px-6 py-3 glass-card !rounded-2xl border border-primary/20 hover:border-primary/50 text-xs font-semibold font-mono normal-case tracking-normal transition-all text-primary"
        >
          {testing ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          Scan Connection
        </motion.button>
      </motion.div>

      {/* Connection Telemetry */}
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-1 md:grid-cols-3 gap-6"
      >
        {/* Endpoint Card */}
        <GlassCard className="p-6 bg-muted border-border group relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
            <Terminal size={60} className="text-primary" />
          </div>
          <label className="text-xs font-mono font-semibold normal-case text-muted-foreground mb-3 block tracking-normal">
            Gateway Endpoint
          </label>
          <div className="flex items-center gap-3 bg-card p-3 rounded-xl border border-border">
            <code className="text-primary font-mono text-xs font-semibold flex-1 truncate">
              {PROXY_ENDPOINT}
            </code>
            <button
              onClick={() => copyToClipboard(PROXY_ENDPOINT, "endpoint")}
              className="w-8 h-8 flex items-center justify-center glass-card border-border hover:border-primary/50 text-muted-foreground hover:text-primary transition-all rounded-lg"
            >
              {copied === "endpoint" ? (
                <CheckCircle size={14} className="text-emerald-500" />
              ) : (
                <Copy size={14} />
              )}
            </button>
          </div>
          <p className="mt-2 text-xs font-mono text-muted-foreground normal-case tracking-wide">
            HTTP CONNECT / SOCKS5 only. See docs/buyer-proxy.md
          </p>
        </GlassCard>

        {/* Status Card */}
        <GlassCard className="p-6 bg-muted border-border relative overflow-hidden">
          <label className="text-xs font-mono font-semibold normal-case text-muted-foreground mb-3 block tracking-normal">
            Signal Integrity
          </label>
          <div className="flex items-center gap-4 py-1.5">
            {connectionStatus === "proxy_verified" && (
              <>
                <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                  <Wifi className="text-emerald-500" size={24} />
                </div>
                <div>
                  <span className="text-emerald-500 font-mono text-xl font-semibold normal-case tracking-tighter">
                    Traffic verified
                  </span>
                  <p role="status" className="text-xs font-mono text-muted-foreground normal-case tracking-normal">
                    {connectionDetail}
                  </p>
                </div>
              </>
            )}
            {connectionStatus === "api_reachable" && (
              <>
                <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
                  <Activity className="text-amber-500" size={24} />
                </div>
                <div>
                  <span className="text-amber-500 font-mono text-xl font-semibold normal-case tracking-tighter">
                    API reachable
                  </span>
                  <p role="status" className="text-xs font-mono text-muted-foreground normal-case tracking-normal">
                    Proxy traffic not tested. Request a session above, then scan again to send a real request through the gateway.
                  </p>
                </div>
              </>
            )}
            {connectionStatus === "proxy_failed" && (
              <>
                <div className="p-3 bg-rose-500/10 rounded-xl border border-rose-500/20">
                  <WifiOff className="text-rose-500" size={24} />
                </div>
                <div>
                  <span className="text-rose-500 font-mono text-xl font-semibold normal-case tracking-tighter">
                    Proxy test failed
                  </span>
                  <p role="alert" className="text-xs font-mono text-muted-foreground normal-case tracking-normal">
                    {connectionDetail}
                  </p>
                </div>
              </>
            )}
            {connectionStatus === "offline" && (
              <>
                <div className="p-3 bg-rose-500/10 rounded-xl border border-rose-500/20">
                  <WifiOff className="text-rose-500" size={24} />
                </div>
                <div>
                  <span className="text-rose-500 font-mono text-xl font-semibold normal-case tracking-tighter">
                    Not reachable
                  </span>
                  {connectionDetail && (
                    <p role="alert" className="text-xs font-mono text-muted-foreground normal-case tracking-normal">
                      {connectionDetail}
                    </p>
                  )}
                </div>
              </>
            )}
            {connectionStatus === "testing" && (
              <>
                <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
                  <Loader2 className="text-amber-500 animate-spin" size={24} />
                </div>
                <span className="text-amber-500 font-mono text-xl font-semibold normal-case tracking-tighter animate-pulse">
                  Probing...
                </span>
              </>
            )}
            {connectionStatus === "idle" && (
              <>
                <div className="p-3 bg-muted rounded-xl border border-border">
                  <Activity className="text-muted-foreground" size={24} />
                </div>
                <span className="text-muted-foreground font-mono text-xl font-semibold normal-case tracking-tighter">
                  Standby
                </span>
              </>
            )}
          </div>
        </GlassCard>

        {/* Active Stream Card */}
        <GlassCard className="p-6 bg-muted border-border relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
            <Zap size={60} className="text-primary" />
          </div>
          <label className="text-xs font-mono font-semibold normal-case text-muted-foreground mb-3 block tracking-normal">
            Active Channels
          </label>
          <div className="flex items-end justify-between">
            <div className="text-4xl font-mono font-semibold text-foreground tracking-tighter">
              {sessions.length + (activeIntent ? 1 : 0)}
            </div>
            <Link
              href="/dashboard/sessions"
              className="group flex items-center gap-2 p-2 px-4 glass-card border-border hover:border-primary/50 text-xs font-semibold font-mono normal-case tracking-normal text-muted-foreground hover:text-primary transition-all rounded-xl shadow-lg"
            >
              Manage Streams{" "}
              <ChevronRight
                size={12}
                className="group-hover:translate-x-1 transition-transform"
              />
            </Link>
          </div>
        </GlassCard>
      </motion.div>

      {sessionIntent && (
        <motion.div variants={itemVariants}>
          <GlassCard className="p-6 bg-emerald-500/5 border-emerald-500/20 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5">
              <ShieldCheck size={72} className="text-emerald-500" />
            </div>
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
              <div className="space-y-3 min-w-0">
                <label className="text-xs font-mono font-semibold normal-case text-emerald-500/70 block tracking-normal">
                  V2 Session Intent
                </label>
                <div className="bg-black/50 rounded-2xl border border-white/5 p-4 font-mono text-xs break-all text-white/70">
                  {"••••••••••••••••••••"}
                </div>
                <p className="text-xs font-mono normal-case tracking-normal text-muted-foreground">
                  State:{" "}
                  {formatIntentLifecycleLabel(
                    persistedIntentStatus?.lifecycle_state ??
                      sessionIntent.lifecycle_state,
                  ).toUpperCase()}{" "}
                  | Expires:{" "}
                  {new Date(
                    persistedIntentStatus?.expires_at ??
                      sessionIntent.expires_at,
                  ).toLocaleTimeString()}
                </p>
              </div>
              <div className="flex flex-col gap-3 lg:w-[360px]">
                <button
                  onClick={() =>
                    copyToClipboard(sessionIntent.token, "intent-token")
                  }
                  className="px-4 py-3 glass-card border-emerald-500/20 hover:border-emerald-500/50 text-xs font-semibold font-mono normal-case tracking-normal text-emerald-400 rounded-2xl flex items-center justify-center gap-2 transition-all"
                >
                  {copied === "intent-token" ? (
                    <CheckCircle size={14} className="text-emerald-500" />
                  ) : (
                    <Copy size={14} />
                  )}
                  Copy Intent Token
                </button>
                <button
                  onClick={() =>
                    copyToClipboard(
                      `curl -x session-intent:${encodeURIComponent(sessionIntent.token)}@${PROXY_ENDPOINT} https://httpbin.org/ip`,
                      "intent-curl",
                    )
                  }
                  className="px-4 py-3 glass-card border-primary/20 hover:border-primary/50 text-xs font-semibold font-mono normal-case tracking-normal text-primary rounded-2xl flex items-center justify-center gap-2 transition-all"
                >
                  {copied === "intent-curl" ? (
                    <CheckCircle size={14} className="text-emerald-500" />
                  ) : (
                    <Terminal size={14} />
                  )}
                  Copy V2 cURL
                </button>
              </div>
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* Tier Selection */}
      {!activeSession && !activeIntent && (
        <motion.div variants={itemVariants} className="space-y-6">
          <div className="flex items-center gap-3 px-4">
            <Hexagon size={18} className="text-primary" />
            <h2 className="text-sm font-semibold font-mono normal-case tracking-normal">
              Select Deployment Tier
            </h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {tiers.map((tier) => (
              <button
                key={tier.id}
                onClick={() => setSelectedTier(tier.id)}
                className={`p-6 glass-card border flex flex-col items-center gap-3 transition-all rounded-3xl relative overflow-hidden group ${
                  selectedTier === tier.id
                    ? `${tier.border} ${tier.bg} ring-2 ring-primary/20`
                    : "border-border bg-muted hover:bg-surface-hover"
                }`}
              >
                <div
                  className={`p-3 rounded-xl bg-card border border-border ${selectedTier === tier.id ? tier.color : "text-muted-foreground"}`}
                >
                  <tier.icon size={20} />
                </div>
                <div className="text-center">
                  <div
                    className={`text-xs font-semibold font-mono normal-case tracking-normal ${selectedTier === tier.id ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {tier.name}
                  </div>
                  {tier.id === "Gold" && (
                    <div className="text-xs font-mono font-bold text-amber-700 dark:text-amber-400 normal-case mt-1 tracking-tighter">
                      Premium QoS
                    </div>
                  )}
                </div>
                {selectedTier === tier.id && (
                  <motion.div
                    layoutId="active-tier"
                    className="absolute bottom-0 left-0 right-0 h-1 bg-primary"
                  />
                )}
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Acquisition Mode / Quick Setup */}
      <motion.div variants={itemVariants} className="space-y-6">
        <div className="flex items-center gap-3 px-4">
          <Zap size={18} className="text-primary" />
          <h2 className="text-sm font-semibold font-mono normal-case tracking-normal">
            {sessions.length === 0
              ? "Create Your First Session"
              : "Your Active Sessions"}
          </h2>
        </div>

        {/* Empty State - No Sessions */}
        {sessions.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-8 border-primary/20 bg-primary/5"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center border border-primary/30 flex-shrink-0">
                <Globe size={24} className="text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold mb-2">Ready to Connect?</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  You don&#39;t have any active proxy sessions yet. Create one
                  below to start browsing securely through our decentralized
                  proxy network.
                </p>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CheckCircle size={12} className="text-emerald-500" />{" "}
                    Residential IPs
                  </span>
                  <span className="flex items-center gap-1">
                    <CheckCircle size={12} className="text-emerald-500" /> 150+
                    Countries
                  </span>
                  <span className="flex items-center gap-1">
                    <CheckCircle size={12} className="text-emerald-500" /> Pay
                    Per GB
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeIntent || activeSession ? (
          <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
            <GlassCard className="p-8 border-emerald-500/20 bg-emerald-500/5 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:opacity-[0.08] transition-all">
                <ShieldCheck size={180} className="text-emerald-500" />
              </div>
              <div className="flex items-center gap-4 mb-8 relative z-10">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                  <CheckCircle
                    className="text-emerald-500 animate-pulse"
                    size={20}
                  />
                </div>
                <div>
                  <span className="text-emerald-500 font-mono text-lg font-semibold normal-case tracking-tighter">
                    {activeIntent ? "Intent Authorized" : "Session Authorized"}
                  </span>
                  <p className="text-xs font-mono text-muted-foreground normal-case tracking-normal">
                    ID: {liveIdentifier} | Protocol: {liveProtocol}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                {/* cURL Example */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold font-mono normal-case text-primary tracking-normal">
                      cURL Intercept
                    </span>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() =>
                        copyToClipboard(
                          liveCurlCopy,
                          activeIntent ? "intent-curl" : "curl",
                        )
                      }
                      className="text-muted-foreground hover:text-primary transition-all text-xs font-semibold font-mono normal-case flex items-center gap-2"
                    >
                      {copied === "curl" || copied === "intent-curl" ? (
                        <CheckCircle size={12} className="text-emerald-500" />
                      ) : (
                        <Copy size={12} />
                      )}
                      Copy Payload
                    </motion.button>
                  </div>
                  <div className="bg-black/60 border border-white/5 rounded-2xl p-6 font-mono text-xs text-white/50 break-all leading-relaxed shadow-inner">
                    <span className="text-emerald-500">$</span> curl -x
                    <span className="text-primary italic">
                      {" "}
                      {liveCurlDisplay.replace("curl -x ", "")}
                    </span>
                  </div>
                </div>

                {/* Node.js Example */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold font-mono normal-case text-primary tracking-normal">
                      Node.js Fragment
                    </span>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => copyToClipboard(liveNodeCopy, "node")}
                      className="text-muted-foreground hover:text-primary transition-all text-xs font-semibold font-mono normal-case flex items-center gap-2"
                    >
                      {copied === "node" ? (
                        <CheckCircle size={12} className="text-emerald-500" />
                      ) : (
                        <Copy size={12} />
                      )}
                      Copy Payload
                    </motion.button>
                  </div>
                  <div className="bg-black/60 border border-white/5 rounded-2xl p-6 font-mono text-xs text-white/50 overflow-x-auto shadow-inner">
                    <code className="block whitespace-pre">
                      {liveNodeDisplay}
                    </code>
                  </div>
                </div>
              </div>
            </GlassCard>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <motion.button
              whileHover={{ y: -8, scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleQuickStart("rotating")}
              disabled={creating}
              className="group p-8 glass-card border-border bg-muted hover:bg-surface-hover hover:border-primary/40 transition-all rounded-3xl text-left relative overflow-hidden disabled:opacity-50 shadow-xl"
            >
              <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-15 transition-all transform group-hover:scale-125 group-hover:rotate-12 duration-700">
                <Globe size={180} className="text-primary" />
              </div>
              <div className="relative z-10">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 mb-6 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
                  {creating ? (
                    <Loader2 size={24} className="animate-spin text-primary" />
                  ) : (
                    <RefreshCw size={24} className="text-primary" />
                  )}
                </div>
                <h3 className="text-2xl font-semibold font-mono normal-case tracking-tighter text-foreground group-hover:text-primary transition-colors mb-3">
                  Rotating Stream
                </h3>
                <p className="text-xs font-mono font-semibold text-muted-foreground normal-case leading-relaxed tracking-normal">
                  NEW IDENTITY PER REQUEST. IDEAL FOR AGGRESSIVE DATA HARVESTING
                  AND ANONYMIZED DISCOVERY.
                </p>
              </div>
            </motion.button>

            <motion.button
              whileHover={{ y: -8, scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleQuickStart("sticky")}
              disabled={creating}
              className="group p-8 glass-card border-border bg-muted hover:bg-surface-hover hover:border-primary/40 transition-all rounded-3xl text-left relative overflow-hidden disabled:opacity-50 shadow-xl"
            >
              <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-15 transition-all transform group-hover:scale-125 group-hover:-rotate-12 duration-700">
                <Shield size={180} className="text-blue-500" />
              </div>
              <div className="relative z-10">
                <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20 mb-6 shadow-[0_0_20px_rgba(59,130,246,0.1)]">
                  {creating ? (
                    <Loader2 size={24} className="animate-spin text-blue-500" />
                  ) : (
                    <Lock size={24} className="text-blue-500" />
                  )}
                </div>
                <h3 className="text-2xl font-semibold font-mono normal-case tracking-tighter text-foreground group-hover:text-blue-400 transition-colors mb-3">
                  Sticky Core
                </h3>
                <p className="text-xs font-mono font-semibold text-muted-foreground normal-case leading-relaxed tracking-normal">
                  PERSISTENT IDENTITY FRAGMENTS. PERFECT FOR SECURE ACCOUNT
                  SIMULATION AND LINEAR SESSIONS.
                </p>
              </div>
            </motion.button>
          </div>
        )}
      </motion.div>

      {/* Network Analytics Preview */}
      <motion.div
        variants={itemVariants}
        className="glass-card p-8 bg-muted border-border relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 -mr-32 -mt-32 rounded-full blur-3xl"></div>

        <div className="flex items-center justify-between mb-10 relative z-10">
          <h2 className="text-sm font-semibold font-mono normal-case tracking-normal flex items-center gap-3">
            <Activity size={18} className="text-primary/70" /> Real-time
            Telemetry
          </h2>
          <Link
            href="/dashboard/usage"
            className="text-xs font-semibold font-mono normal-case tracking-normal text-primary hover:text-emerald-400 transition-all flex items-center gap-2 px-4 py-2 glass-card border-border"
          >
            ANALYTICS VAULT <ExternalLink size={12} />
          </Link>
        </div>

        {sessions.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-4">📊</div>
            <p className="text-sm text-muted-foreground mb-2">
              No telemetry data yet
            </p>
            <p className="text-xs text-muted-foreground">
              Create a session above to start tracking your proxy usage
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 relative z-10">
            {[
              {
                label: "Requests Today",
                value: analytics?.total_requests?.toLocaleString() || "0",
                color: "text-foreground",
              },
              {
                label: "Data Pipeline",
                value: `${analytics?.total_bandwidth_gb?.toFixed(2) || "0.00"} GB`,
                color: "text-primary",
              },
              {
                label: "Avg Latency",
                value: `${analytics?.avg_latency_ms || "0"}ms`,
                color: "text-foreground",
              },
              {
                label: "Success Rate",
                value: `${analytics?.success_rate || "0"}%`,
                color: "text-emerald-500",
              },
            ].map((stat, i) => (
              <div
                key={i}
                className="p-6 glass-card bg-muted border-border rounded-2xl group hover:bg-surface-hover transition-all"
              >
                {analyticsLoading ? (
                  <div className="h-10 w-20 bg-secondary animate-pulse rounded mb-2" />
                ) : (
                  <div
                    className={`text-3xl font-mono font-semibold tracking-tighter mb-2 ${stat.color}`}
                  >
                    {stat.value}
                  </div>
                )}
                <div className="text-xs font-mono font-semibold normal-case text-muted-foreground tracking-normal">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Integration Matrices */}
      <motion.div
        variants={itemVariants}
        className="glass-card p-8 bg-muted border-border"
      >
        <h2 className="text-sm font-semibold font-mono normal-case tracking-normal mb-4 flex items-center gap-3 relative z-10">
          <Settings size={18} className="text-muted-foreground" /> Integration
          Matrices
        </h2>
        <p className="text-xs text-muted-foreground mb-8 relative z-10 max-w-2xl">
          Official SDKs for Connect session intents and marketplace credentials.
          Install a client, then use the quick-start snippets above.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 relative z-10">
          {SDK_MATRIX.map((guide) => (
            <button
              key={guide.id}
              type="button"
              onClick={() =>
                setSdkGuide((prev) => (prev === guide.id ? null : guide.id))
              }
              className={`p-6 glass-card border-border ${guide.bg} transition-all rounded-2xl text-center group active:scale-95 ${
                sdkGuide === guide.id
                  ? "border-primary/40 ring-1 ring-primary/30"
                  : ""
              }`}
            >
              <div className="text-lg font-semibold font-mono mb-4 text-muted-foreground group-hover:text-foreground transition-colors tracking-tight">
                {guide.icon}
              </div>
              <div className="text-xs font-semibold font-mono normal-case tracking-normal text-muted-foreground group-hover:text-foreground transition-colors">
                {guide.name}
              </div>
            </button>
          ))}
        </div>
        <AnimatePresence>
          {sdkGuide &&
            (() => {
              const selected = SDK_MATRIX.find((g) => g.id === sdkGuide);
              if (!selected) return null;
              return (
                <motion.div
                  key={selected.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  className="mt-6 relative z-10 rounded-2xl border border-border bg-card p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs font-semibold font-mono normal-case tracking-normal text-foreground">
                      {selected.name}
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={selected.docs}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-mono normal-case tracking-normal text-muted-foreground hover:text-foreground"
                      >
                        Docs <ExternalLink size={12} />
                      </a>
                      <a
                        href={selected.registry}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-mono normal-case tracking-normal text-muted-foreground hover:text-foreground"
                      >
                        Registry <ExternalLink size={12} />
                      </a>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2.5">
                    <code className="flex-1 text-xs font-mono text-emerald-400/90 break-all">
                      {selected.install}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(selected.install, `sdk-${selected.id}`)
                      }
                      className="shrink-0 p-1.5 rounded-lg hover:bg-surface-hover text-muted-foreground"
                      aria-label="Copy install command"
                    >
                      {copied === `sdk-${selected.id}` ? (
                        <CheckCircle size={14} className="text-emerald-500" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>
                </motion.div>
              );
            })()}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
