"use client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { auditKeys, getCapabilities, type AuditCapabilities } from "@/lib/api/audits";

/** What this server can audit right now. One cached query shared by every audit entry point. */
export function useAuditCapabilities() {
  const { isAuthenticated } = useAuth();
  return useQuery({ queryKey: auditKeys.capabilities(), queryFn: getCapabilities, enabled: isAuthenticated, staleTime: 30_000 });
}

/**
 * Whether audit entry points should appear at all. They stay out of sight where the Regional Auditor service
 * is simply not deployed, so no one is offered a feature that cannot run. A service that is configured but
 * temporarily unreachable still shows them (with the reason) so the problem is visible.
 */
export function auditsOffered(caps: AuditCapabilities | undefined): boolean {
  return !!caps && caps.auditorProblem?.code !== "auditor_not_configured";
}
