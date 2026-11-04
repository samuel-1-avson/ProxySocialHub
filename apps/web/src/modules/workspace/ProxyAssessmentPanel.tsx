"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createProxyAssessment, getProxyAssessment, type ProxyAssessment, type ProxyAssessmentConfiguration } from "@/lib/api/marketplace";
import { DataError, amount } from "@/components/workspace/Patterns";

export function assessmentMatches(a: ProxyAssessment | null, nodeId: string, config: ProxyAssessmentConfiguration): a is ProxyAssessment {
  return Boolean(a && a.provider_node_id === nodeId && a.proxy_type === config.proxy_type && a.protocol === config.protocol && a.rotation_type === config.rotation_type && a.country === config.country && a.max_concurrency === config.max_concurrency && a.status === "passed" && a.valid_until && Date.parse(a.valid_until) > Date.now());
}

export function ProxyAssessmentPanel({ nodeId, config, onAccepted }: {
  nodeId: string;
  config: ProxyAssessmentConfiguration;
  onAccepted: (assessment: ProxyAssessment) => void;
}) {
  const [jobId, setJobId] = useState("");
  const [acceptedId, setAcceptedId] = useState("");
  const request = useMutation({
    mutationFn: () => createProxyAssessment(nodeId, config),
    onSuccess: (a) => { setJobId(a.id); setAcceptedId(""); },
  });
  const job = useQuery({
    queryKey: ["proxy-assessment", jobId],
    queryFn: () => getProxyAssessment(jobId),
    enabled: Boolean(jobId),
    refetchInterval: (q) => ["passed", "failed", "unavailable"].includes(q.state.data?.status ?? "") ? false : 2000,
    retry: 1,
  });
  const result = job.data;
  const busy = request.isPending || Boolean(jobId && (!result || ["queued", "running"].includes(result.status)) && !job.isError);
  const compatible = assessmentMatches(result ?? null, nodeId, config);
  return (
    <section className="ui-page" aria-label="Proxy quality assessment">
      <h3>Assess quality & price</h3>
      <p className="ui-note">Test this node before publishing. Three small HTTPS transfers measure connectivity, response time and transfer speed. The initial rating is provisional.</p>
      <button type="button" className="ui-button secondary" disabled={!nodeId || busy || !Number.isInteger(config.max_concurrency) || config.max_concurrency < 1 || config.max_concurrency > 100 || !config.protocol} onClick={() => request.mutate()}>
        {busy ? "Assessing proxy…" : result ? "Run a new assessment" : "Assess this proxy"}
      </button>
      {busy && <p className="ui-note" role="status">{result?.status === "running" ? "Measuring HTTPS performance through your node…" : "Assessment queued. Keep your node connected."}</p>}
      {request.isError && <DataError error={request.error} />}
      {job.isError && <DataError error={job.error} retry={() => void job.refetch()} />}
      {result && !["queued", "running"].includes(result.status) && (
        <div className="ui-attention" role="status">
          <p><strong>{result.status === "passed" ? `${result.tier} · ${amount(result.quality_score, 1)}/100 · provisional` : result.status === "failed" ? "Improvements needed" : "Assessment unavailable"}</strong></p>
          <p>{result.summary}</p>
          {result.status === "passed" && <>
            <p>Evidence confidence: {Math.round(result.confidence * 100)}%. Price expires {new Date(result.valid_until!).toLocaleTimeString()}.</p>
            {!compatible && <p>Configuration changed or price expired. Run a new assessment.</p>}
            <button type="button" className="ui-button" disabled={!compatible || acceptedId === result.id} onClick={() => { onAccepted(result); setAcceptedId(result.id); }}>
              {acceptedId === result.id ? "Price accepted" : `Accept $${amount(result.price_per_gb, 4)} / GB`}
            </button>
          </>}
        </div>
      )}
    </section>
  );
}
