"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScanSearch } from "lucide-react";
import { Modal } from "@/components/patterns/Modal";
import { countryName } from "@/components/workspace/Patterns";
import { auditKeys, listAuditOrders } from "@/lib/api/audits";
import { AuditForm } from "./Audits";
import { useAuditCapabilities } from "./useAuditCapabilities";

/**
 * "Check a website from this order's region", placed where the user already holds access (an order's page and
 * the access cards in Connections) instead of on a page of its own. It opens the audit form in a dialog with the
 * region and order already decided; the finished report opens like any other audit.
 *
 * It renders nothing unless the auditor is configured for live audits AND the order is one of the user's active
 * orders, so it never offers something that cannot run.
 */
export function AuditLauncher({ orderId, variant = "card" }: { orderId: string; variant?: "card" | "button" }) {
  const caps = useAuditCapabilities();
  const live = caps.data?.auditor?.modes.live;
  const orders = useQuery({ queryKey: auditKeys.orders(), queryFn: listAuditOrders, enabled: !!live?.available, staleTime: 15_000 });
  const [open, setOpen] = useState(false);

  const order = orders.data?.orders.find((o) => o.id === orderId);
  if (!live?.available || !caps.data || !order) return null;

  const region = order.country;
  const regionLabel = region ? `${countryName(region)} (${region})` : null;

  if (variant === "button") {
    if (!region) return null;
    return (
      <>
        <button type="button" className="ui-button secondary" onClick={() => setOpen(true)}>
          <ScanSearch size={14} aria-hidden="true" /> Audit a site
        </button>
        <LauncherDialog open={open} onOpenChange={setOpen} regionLabel={regionLabel!} orderId={orderId} />
      </>
    );
  }

  return (
    <section className="audit-launch-card" aria-labelledby={`audit-launch-${orderId}`} data-testid="audit-launch-card">
      <span className="audit-launch-icon" aria-hidden="true">
        <ScanSearch size={18} />
      </span>
      <div>
        <h3 id={`audit-launch-${orderId}`}>Check a website from {regionLabel ?? "this order's region"}</h3>
        <p>
          {region
            ? "See how a site you are authorized to test looks from this exit: screenshots, request evidence and an AI-written report. It reads the site only, and uses some of this order's bandwidth."
            : "This listing does not declare a country, so there is no region to audit from."}
        </p>
      </div>
      {region && (
        <button type="button" className="ui-button secondary" onClick={() => setOpen(true)}>
          Audit a site…
        </button>
      )}
      {region && <LauncherDialog open={open} onOpenChange={setOpen} regionLabel={regionLabel!} orderId={orderId} />}
    </section>
  );
}

function LauncherDialog({ open, onOpenChange, regionLabel, orderId }: { open: boolean; onOpenChange: (open: boolean) => void; regionLabel: string; orderId: string }) {
  const caps = useAuditCapabilities();
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Audit a site from ${regionLabel}`}
      description="Runs over this order. The report opens when it is ready; you can leave the page meanwhile."
      size="xl"
      contentClassName="audit-launch-modal"
    >
      {caps.data && <AuditForm caps={caps.data} preset={{ orderId }} embedded />}
    </Modal>
  );
}
