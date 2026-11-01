"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, MessageSquare, Send } from "lucide-react";
import { getAccessTokenSilently, useAuth } from "@/lib/auth";
import { Modal } from "@/components/patterns/Modal";

interface QuickMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  listingId: string;
  listingTitle: string;
  providerId: string;
  providerName: string;
  providerAvatar?: string;
  providerOnline?: boolean;
  pricePerGb?: number;
  location?: string;
}
const intents = [
  ["web_scraping", "Web scraping"], ["vpn", "VPN / privacy"],
  ["gaming", "Gaming"], ["social_media", "Social media management"],
  ["seo", "SEO / marketing"], ["testing", "Testing / development"], ["other", "Other"],
];

export function QuickMessageModal(props: QuickMessageModalProps) {
  return <InquiryForm key={props.listingId} {...props} />;
}
function InquiryForm({ isOpen, onClose, listingId, listingTitle, providerId, providerName, providerOnline, pricePerGb, location }: QuickMessageModalProps) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [intent, setIntent] = useState("");
  const [expectedGb, setExpectedGb] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  async function send(event: FormEvent) {
    event.preventDefault();
    if (sending || sent || !message.trim()) return;
    if (!isAuthenticated) {
      router.push("/login?redirect=" + encodeURIComponent(window.location.pathname + window.location.search));
      return;
    }
    setSending(true); setError("");
    try {
      const token = await getAccessTokenSilently();
      const response = await fetch("/v1/listings/" + encodeURIComponent(listingId) + "/inquire", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
        body: JSON.stringify({ message: message.trim(), intent: intent || undefined, expected_gb: expectedGb ? Number(expectedGb) : undefined }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(typeof detail.error === "string" ? detail.error : "Your inquiry could not be sent. Please try again.");
      }
      setSent(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your inquiry could not be sent. Please try again.");
    } finally { setSending(false); }
  }
  return (
    <Modal open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}
      title={sent ? "Inquiry sent" : "Message " + providerName}
      description={sent ? "The service accepted your inquiry. A reply has not been received yet." : "Ask about this offer before purchasing. Your draft stays available if sending fails."}
      size="lg" contentClassName="space-y-5">
      {sent ? <div className="space-y-5">
        <CheckCircle2 className="text-primary" size={32} aria-hidden />
        <p className="text-sm text-muted-foreground">Your question about <strong className="text-foreground">{listingTitle}</strong> was sent.</p>
        <div className="ui-actions">
          <Link className="ui-button" href={"/messages?recipient=" + encodeURIComponent(providerId)}>Open inbox</Link>
          <button type="button" className="ui-button secondary" onClick={onClose}>Done</button>
        </div>
      </div> : <form onSubmit={(event) => void send(event)} className="space-y-5">
        <div className="rounded-xl border border-border bg-secondary p-4 space-y-1">
          <p className="text-sm font-semibold flex items-center gap-2"><MessageSquare size={16} aria-hidden />{listingTitle}</p>
          <p className="text-sm text-muted-foreground">{location || "Location not reported"}{Number.isFinite(pricePerGb) ? " · $" + Number(pricePerGb).toFixed(4) + " / GB" : ""}</p>
          {providerOnline && <p className="text-xs text-primary">Provider reports online</p>}
        </div>
        <label className="grid gap-2 text-sm font-medium">Intended use <span className="sr-only">(optional)</span>
          <select className="ui-input" value={intent} onChange={(event) => setIntent(event.target.value)}>
            <option value="">Choose a use (optional)</option>
            {intents.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium">Expected monthly usage
          <select className="ui-input" value={expectedGb} onChange={(event) => setExpectedGb(event.target.value)}>
            <option value="">Not sure yet</option>
            {[10, 50, 100, 500, 1000].map((value) => <option key={value} value={value}>{value.toLocaleString()} GB / month</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium">Your message
          <textarea className="ui-input min-h-32 resize-y" rows={4} required maxLength={4000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="What would you like to know about this offer?" aria-describedby={error ? "inquiry-error" : undefined} />
        </label>
        {error && <p id="inquiry-error" className="text-sm text-destructive" role="alert">{error}</p>}
        <div className="ui-actions justify-end">
          <button type="button" className="ui-button secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="ui-button" disabled={sending || !message.trim()} aria-busy={sending}>
            {sending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Send size={16} aria-hidden />}
            {sending ? "Sending…" : isAuthenticated ? "Send inquiry" : "Sign in to send"}
          </button>
        </div>
      </form>}
    </Modal>
  );
}
