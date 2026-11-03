"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Fingerprint, Loader2, Server, Wifi } from "lucide-react";
import {
  createNode,
  createProviderToken,
  getProviderReadiness,
  getProviderStatus,
  type CreateTokenResponse,
} from "@/lib/api/provider";
import { updateOnboarding, type OnboardingState } from "@/lib/api/onboarding";
import { trackOnboardingEvent } from "@/lib/analytics/onboarding-funnel";
import { saveProviderApiKey } from "@/lib/provider-config";
import { ROUTES } from "@/lib/navigation/routes";
import { getErrorMessage } from "@/lib/utils";
import { normalizeCountryCode } from "@/lib/geo/regional-hubs";
import { ProviderApplicationForm } from "@/components/ProviderApplicationForm";
import { CountrySelect } from "@/components/ui/CountrySelect";

export function OnboardingApplyPanel({
  onboarding,
  onStateChange,
}: {
  onboarding: OnboardingState;
  onStateChange: (next: OnboardingState) => void;
}) {
  const { data: providerStatus } = useQuery({
    queryKey: ["provider-status"],
    queryFn: getProviderStatus,
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 15_000 : false),
  });

  const markApplyComplete = async (status: string) => {
    trackOnboardingEvent("provider_apply_result", { status });
    let next = onboarding;
    if (!next.steps?.apply?.completed_at) {
      next = await updateOnboarding({
        complete_step: "apply",
        step_meta: { status },
      });
      trackOnboardingEvent("step_completed", { step: "apply" });
    }
    onStateChange(next);
  };

  // Already applied before visiting this step.
  if (providerStatus?.status === "approved") {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold font-mono border-b border-border pb-3">
          Provider application
        </h2>
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-primary" />
          Application approved.
        </p>
        {!onboarding.steps?.apply?.completed_at ? (
          <button
            type="button"
            className="btn-retro btn-retro-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm"
            onClick={() => void markApplyComplete("approved")}
          >
            Continue
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <p className="text-xs font-mono text-muted-foreground">Advancing…</p>
        )}
      </div>
    );
  }

  if (onboarding.kyc_status !== "approved") {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold font-mono border-b border-border pb-3">
          Provider application
        </h2>
        <p className="text-sm text-muted-foreground">
          KYC must be approved before you can apply. Current status:{" "}
          <span className="font-mono">{onboarding.kyc_status}</span>
        </p>
      </div>
    );
  }

  if (providerStatus?.status === "pending") {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold font-mono border-b border-border pb-3">
          Provider application
        </h2>
        <p className="text-sm text-muted-foreground">
          Application submitted and pending automatic recheck. You can continue once approved, or wait here.
        </p>
        <p className="text-xs font-mono text-muted-foreground">
          Status: pending · refreshes automatically
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold font-mono border-b border-border pb-3">
        Provider application
      </h2>
      <ProviderApplicationForm
        embedded
        onApplied={async (result) => {
          trackOnboardingEvent("provider_apply_submitted", {
            status: result.application.status,
          });
          if (result.application.status === "approved") {
            await markApplyComplete("approved");
          } else if (result.application.status === "pending") {
            trackOnboardingEvent("provider_apply_result", { status: "pending" });
          }
        }}
      />
    </div>
  );
}

export function OnboardingProviderSetupPanel({
  step,
  onboarding,
  onStateChange,
}: {
  step: "token" | "node" | "online";
  onboarding: OnboardingState;
  onStateChange: (next: OnboardingState) => void;
}) {
  const qc = useQueryClient();
  const [tokenName, setTokenName] = useState("onboarding-node");
  const [createdToken, setCreatedToken] = useState<CreateTokenResponse | null>(null);
  const [nodeName, setNodeName] = useState("");
  const [nodeCountry, setNodeCountry] = useState("");
  const [countryTouched, setCountryTouched] = useState(false);
  const [error, setError] = useState("");

  const { data: readiness } = useQuery({
    queryKey: ["provider-readiness"],
    queryFn: getProviderReadiness,
    refetchInterval: step === "online" ? 12_000 : false,
  });
  const { data: providerStatus } = useQuery({
    queryKey: ["provider-status"],
    queryFn: getProviderStatus,
    staleTime: 60_000,
    enabled: step === "node",
  });

  useEffect(() => {
    if (countryTouched || nodeCountry.trim()) return;
    const detected = normalizeCountryCode(providerStatus?.detected_geo?.country);
    if (detected) setNodeCountry(detected);
  }, [providerStatus?.detected_geo?.country, countryTouched, nodeCountry]);

  const completeStep = async (id: "token" | "node" | "online", meta?: Record<string, unknown>) => {
    let next = onboarding;
    if (!next.steps?.[id]?.completed_at) {
      next = await updateOnboarding({ complete_step: id, step_meta: meta });
      trackOnboardingEvent("step_completed", { step: id });
    }
    onStateChange(next);
  };

  const tokenMutation = useMutation({
    mutationFn: () => createProviderToken({ name: tokenName.trim() || "onboarding-node" }),
    onSuccess: async (res) => {
      setCreatedToken(res);
      saveProviderApiKey(res.token);
      await qc.invalidateQueries({ queryKey: ["provider-tokens", "provider-readiness"] });
      trackOnboardingEvent("token_created");
      await completeStep("token", { token_id: res.id });
    },
    onError: (err) => setError(getErrorMessage(err) || "Failed to create token"),
  });

  const nodeMutation = useMutation({
    mutationFn: () =>
      createNode({
        name: nodeName.trim() || "my-node",
        country: nodeCountry.trim() || undefined,
      }),
    onSuccess: async (node) => {
      await qc.invalidateQueries({ queryKey: ["my-nodes", "provider-readiness"] });
      trackOnboardingEvent("node_registered");
      await completeStep("node", { node_id: node.id });
    },
    onError: (err) => setError(getErrorMessage(err) || "Failed to register node"),
  });

  if (step === "token") {
    const alreadyHasToken = (readiness?.summary.active_tokens || 0) > 0;
    return (
      <div className="space-y-5">
        <h2 className="text-lg font-bold font-mono border-b border-border pb-3 flex items-center gap-2">
          <Fingerprint className="w-4 h-4 text-primary" />
          Create provider token
        </h2>
        <p className="text-sm text-muted-foreground">
          Tokens authenticate your node daemon. The raw secret is shown once. Copy it now.
        </p>
        {alreadyHasToken && !createdToken ? (
          <button
            type="button"
            className="btn-retro btn-retro-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm"
            onClick={() => void completeStep("token", { existing: true })}
          >
            Token already exists. Continue
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <div className="space-y-3">
            <label className="block text-xs font-mono text-muted-foreground">Token name</label>
            <input
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              className="w-full border border-border bg-background px-3 py-2.5 font-mono text-sm"
              placeholder="my-node"
            />
            <button
              type="button"
              disabled={tokenMutation.isPending}
              onClick={() => {
                setError("");
                tokenMutation.mutate();
              }}
              className="btn-retro btn-retro-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm"
            >
              {tokenMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
              Create token
            </button>
          </div>
        )}
        {createdToken && (
          <div className="border border-border bg-background p-4 space-y-2">
            <p className="text-xs font-mono text-muted-foreground">Raw token (copy once)</p>
            <code className="block text-xs break-all font-mono select-all">{createdToken.token}</code>
          </div>
        )}
        {error && <p className="text-sm font-mono text-destructive">{error}</p>}
        <Link href={ROUTES.dashboardProviderTokens} className="text-xs font-mono text-primary hover:underline">
          Manage tokens
        </Link>
      </div>
    );
  }

  if (step === "node") {
    const alreadyHasNode = (readiness?.summary.nodes || 0) > 0;
    return (
      <div className="space-y-5">
        <h2 className="text-lg font-bold font-mono border-b border-border pb-3 flex items-center gap-2">
          <Server className="w-4 h-4 text-primary" />
          Register node
        </h2>
        <p className="text-sm text-muted-foreground">
          Register a node record, then install the CLI and connect with your token.
        </p>
        {alreadyHasNode ? (
          <button
            type="button"
            className="btn-retro btn-retro-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm"
            onClick={() => void completeStep("node", { existing: true })}
          >
            Node already registered. Continue
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <div className="space-y-3">
            <label className="block text-xs font-mono text-muted-foreground">Node name</label>
            <input
              value={nodeName}
              onChange={(e) => setNodeName(e.target.value)}
              className="w-full border border-border bg-background px-3 py-2.5 font-mono text-sm"
              placeholder="home-node-1"
            />
            <label className="block text-xs font-mono text-muted-foreground">
              Country
              {normalizeCountryCode(providerStatus?.detected_geo?.country) &&
              normalizeCountryCode(nodeCountry) ===
                normalizeCountryCode(providerStatus?.detected_geo?.country)
                ? " (detected)"
                : ""}
            </label>
            <CountrySelect
              value={nodeCountry}
              onChange={(code) => {
                setCountryTouched(true);
                setNodeCountry(code);
              }}
              label="Country"
            />
            <p className="text-xs font-mono text-muted-foreground">
              Detected from your connection when possible. City is optional. Set it later for finer map routing.
            </p>
            <button
              type="button"
              disabled={nodeMutation.isPending}
              onClick={() => {
                setError("");
                nodeMutation.mutate();
              }}
              className="btn-retro btn-retro-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm"
            >
              {nodeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Server className="w-4 h-4" />}
              Register node
            </button>
          </div>
        )}
        {error && <p className="text-sm font-mono text-destructive">{error}</p>}
        <Link href={ROUTES.dashboardProviderSetup} className="text-xs font-mono text-primary hover:underline">
          Open full setup wizard
        </Link>
      </div>
    );
  }

  // online
  const onlineCount = readiness?.summary.online_nodes || 0;
  const ready = onlineCount > 0 || readiness?.summary.ready_for_traffic;

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold font-mono border-b border-border pb-3 flex items-center gap-2">
        <Wifi className="w-4 h-4 text-primary" />
        Go online
      </h2>
      <p className="text-sm text-muted-foreground">
        Install the provider CLI, configure your token, and keep the daemon running until a heartbeat lands.
      </p>
      <div className="border border-border bg-background p-4 text-xs font-mono space-y-1">
        <p>Online nodes: {onlineCount}</p>
        <p>Ready for traffic: {readiness?.summary.ready_for_traffic ? "yes" : "no"}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href={ROUTES.dashboardProviderCli} className="btn-retro btn-retro-outline inline-flex px-4 py-2.5 text-sm">
          CLI download
        </Link>
        <Link href={ROUTES.dashboardProviderSetup} className="btn-retro btn-retro-outline inline-flex px-4 py-2.5 text-sm">
          Setup wizard
        </Link>
        <button
          type="button"
          disabled={!ready}
          onClick={async () => {
            trackOnboardingEvent("node_online");
            let next = onboarding;
            if (!next.steps?.online?.completed_at) {
              next = await updateOnboarding({
                complete_step: "online",
                step_meta: { online_nodes: onlineCount },
              });
              trackOnboardingEvent("step_completed", { step: "online" });
            }
            const catalog = next.step_catalog?.length ? next.step_catalog : ["online"];
            const endsAtOnline = catalog[catalog.length - 1] === "online";
            if (endsAtOnline) {
              next = await updateOnboarding({ complete: true });
              trackOnboardingEvent("onboarding_completed", { intent: next.intent || "provider" });
            }
            onStateChange(next);
          }}
          className="btn-retro btn-retro-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm disabled:opacity-50"
        >
          {ready
            ? ((onboarding.step_catalog?.length ? onboarding.step_catalog : ["online"]).at(-1) === "online"
              ? "Mark online & finish"
              : "Mark online & continue")
            : "Waiting for heartbeat…"}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
