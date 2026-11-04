"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { ArrowDown, ArrowRight, Check, CircleHelp, MessageCircle, RotateCcw, Send, ShieldCheck, Square, X } from "lucide-react";
import { containsLikelySecret, safeAssistantHref, type AssistantAction, type AssistantActionResult } from "@/lib/assistant";
import type { HubbieChat } from "./useHubbieChat";

const PROMPTS = [
  { label: "Find a proxy", text: "Help me find a proxy. What should I compare before buying?" },
  { label: "Check my orders", text: "Check my recent orders and help me understand their status." },
  { label: "Fix a connection", text: "My proxy is not connecting. Help me troubleshoot it." },
  { label: "Become a provider", text: "How do I start providing bandwidth on ProxyHubb?" },
];

function HubbieLink({ href, children }: { href: string; children: ReactNode }) {
  return href.startsWith("/") ? <Link href={href} prefetch={false}>{children}</Link> : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

/** Approval card for a Hubbie-prepared draft. Nothing runs until Approve is pressed. */
function AssistantActionCard({ action, approve }: { action: AssistantAction; approve: (draftId: string) => Promise<AssistantActionResult> }) {
  const [state, setState] = useState<"idle" | "working" | "done" | "error" | "dismissed">("idle");
  const [result, setResult] = useState<AssistantActionResult | null>(null);
  const [failure, setFailure] = useState("");
  if (state === "dismissed") return null;
  async function run() {
    setState("working");
    try {
      const outcome = await approve(action.draftId);
      setResult(outcome);
      setState("done");
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : "The action could not be completed.");
      setState("error");
    }
  }
  return (
    <div className="assistant-action" aria-label={`Approval needed: ${action.title}`}>
      <p className="assistant-action-title"><ShieldCheck size={14} aria-hidden="true" />{action.title}</p>
      <ul className="assistant-action-summary">
        {action.summary.map((line) => <li key={line}>{line}</li>)}
      </ul>
      {state === "idle" && (
        <div className="assistant-action-buttons">
          <button type="button" className="assistant-action-approve" onClick={() => void run()}>{action.confirmLabel}</button>
          <button type="button" className="assistant-action-dismiss" onClick={() => setState("dismissed")}>Not now</button>
          <span className="assistant-action-expiry">Expires {new Date(action.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
        </div>
      )}
      {state === "working" && <p className="assistant-action-result" role="status"><span className="assistant-working-dot" />Working… keep this tab open.</p>}
      {state === "done" && result && (
        <div className="assistant-action-result" role="status">
          <p><strong>{result.title}.</strong> {result.message}</p>
          {result.href && safeAssistantHref(result.href) && <HubbieLink href={result.href}>Open it<ArrowRight size={13} aria-hidden="true" /></HubbieLink>}
        </div>
      )}
      {state === "error" && <p className="assistant-action-result" role="alert">{failure}</p>}
    </div>
  );
}

export default function HubbieAssistant({ chat, onClose }: { chat: HubbieChat; onClose: () => void }) {
  const { user, isAuthenticated, messages, draft, setDraft, busy, status, steps, error, mode, liveText, input, clear, send, stop, approveAction } = chat;
  const [pasteBlocked, setPasteBlocked] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, steps, busy, liveText]);
  const guideMode = mode === "guides" || !isAuthenticated;
  const last = messages[messages.length - 1];
  function submit(event: FormEvent) { event.preventDefault(); void send(draft); }
  function guardPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = event.clipboardData.getData("text");
    if (pasted && containsLikelySecret(pasted)) { event.preventDefault(); setPasteBlocked(true); }
  }

  if (!isAuthenticated) return <p>Sign in to your account to talk with Hubbie.</p>;
  const accountName = (user?.display_name || user?.username || (user?.wallet_address ? `${user.wallet_address.slice(0, 4)}…${user.wallet_address.slice(-4)}` : "your account")).slice(0, 48);
  return (
      <section className="assistant-panel" aria-label="Hubbie personal assistant">
          <header className="assistant-header">
            <span className="assistant-mark"><MessageCircle size={22} strokeWidth={1.6} aria-hidden="true" /></span>
            <div>
              <h2>Hubbie <span className="hubbie-ai-badge">AI</span></h2>
              <p className="assistant-mode"><span />{mode === null ? "Checking availability" : guideMode ? "Help guides" : "Meta AI · Platform tools"}</p>
            </div>
            <div className="assistant-header-actions">
              <button type="button" onClick={clear} aria-label="Start a new conversation" title="New conversation"><RotateCcw size={16} aria-hidden="true" /></button>
              <button type="button" onClick={onClose} aria-label="Close Hubbie" title="Minimize Hubbie"><X size={19} aria-hidden="true" /></button>
            </div>
          </header>
          <p className="sr-only">Your personal ProxyHubb assistant. Ask platform questions, find proxy listings, and check your own orders or provider nodes. Review transactions in your wallet.</p>
          <div className="assistant-context"><ShieldCheck size={14} aria-hidden="true" /><span>For {accountName} · You review every payment.</span></div>
          <div ref={log} className="assistant-conversation" role="log" aria-label="Hubbie conversation" aria-live="polite" aria-relevant="additions" aria-busy={busy}>
            {!messages.length && (
              <div className="assistant-welcome">
                <span className="assistant-eyebrow">Here for your next step</span>
                <h2>Hi, I’m Hubbie.<br />How can I help?</h2>
                <p>Find the right proxy, understand an order, or get your provider node running.</p>
                <div className="assistant-prompts">
                  {PROMPTS.map((prompt) => <button type="button" key={prompt.label} disabled={busy} onClick={() => void send(prompt.text)}>{prompt.label}<ArrowRight size={15} aria-hidden="true" /></button>)}
                </div>
                <div className="assistant-privacy"><CircleHelp size={15} aria-hidden="true" /><p>Chat stays in this tab as you browse and clears when you reload or sign out. For live AI, Meta receives your messages and requested account summaries. Keep passwords, keys, and seed phrases out of chat.</p></div>
              </div>
            )}
            {messages.map((message) => (
              <article key={message.id} className={`assistant-message assistant-message-${message.role}`} aria-label={message.role === "user" ? "You" : "Hubbie"}>
                <p className="assistant-message-label">{message.role === "user" ? "You" : message.reply?.mode === "guides" ? "Hubbie · Help guides" : "Hubbie"}</p>
                {message.reply?.steps.length ? <div className="assistant-steps">{message.reply.steps.map((step, i) => <p key={i}>{step.ok ? <Check size={12} aria-hidden="true" /> : <CircleHelp size={12} aria-hidden="true" />}{step.label}</p>)}</div> : null}
                <div className="assistant-markdown">
                  <ReactMarkdown components={{ a: ({ href, children }) => href && safeAssistantHref(href) ? <HubbieLink href={href}>{children}</HubbieLink> : <span>{children}</span>, img: () => null }}>{message.content}</ReactMarkdown>
                </div>
                {message.reply?.sources.length ? <div className="assistant-sources" aria-label="Sources and next steps">{message.reply.sources.filter((source) => safeAssistantHref(source.href)).map((source) => <HubbieLink key={source.href} href={source.href}>{source.title}<ArrowRight size={13} aria-hidden="true" /></HubbieLink>)}</div> : null}
                {message.reply?.actions?.map((action) => <AssistantActionCard key={action.draftId} action={action} approve={approveAction} />)}
              </article>
            ))}
            {liveText && (
              <article className="assistant-message assistant-message-assistant" aria-label="Hubbie">
                <p className="assistant-message-label">Hubbie</p>
                <div className="assistant-markdown">
                  <ReactMarkdown components={{ a: ({ href, children }) => href && safeAssistantHref(href) ? <HubbieLink href={href}>{children}</HubbieLink> : <span>{children}</span>, img: () => null }}>{liveText}</ReactMarkdown>
                </div>
              </article>
            )}
            {busy && <div className="assistant-working" role="status"><div className="assistant-steps">{steps.map((step, i) => <p key={i}>{step.ok ? <Check size={12} aria-hidden="true" /> : <CircleHelp size={12} aria-hidden="true" />}{step.label}</p>)}</div><p><span className="assistant-working-dot" />{status || "Working on your request"}</p></div>}
          </div>
          {error && <div className="assistant-error" role="alert"><p>{error}</p>{last?.role === "user" && !busy && <button type="button" onClick={() => void send(last.content, true)}>Try again <ArrowDown size={13} aria-hidden="true" /></button>}</div>}
          <footer className="assistant-footer">
            {pasteBlocked && <p className="assistant-guide-note" role="alert">That looked like a seed phrase or private key, so it was not pasted. Never share it in chat — ProxyHubb will never ask for it. <button type="button" onClick={() => setPasteBlocked(false)}>Dismiss</button></p>}
            {guideMode && <p className="assistant-guide-note">{!isAuthenticated ? <>Sign in for live AI and account checks. </> : "Live AI is not enabled on this server. "}Guide answers do not check live data.</p>}
            {busy ? null : last?.role === "user" && !error && <p className="assistant-guide-note">Request stopped. <button type="button" onClick={() => void send(last.content, true)}>Try again</button></p>}
            <form onSubmit={submit} className="assistant-composer">
              <label htmlFor="assistant-question" className="sr-only">Your question</label>
              <textarea ref={input} id="assistant-question" value={draft} maxLength={2000} rows={2} placeholder="Ask Hubbie about your next step…" disabled={busy} aria-describedby="assistant-input-note" onPaste={guardPaste}
                onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); } }} />
              {busy ? <button type="button" onClick={stop} aria-label="Stop response"><Square size={15} fill="currentColor" aria-hidden="true" /></button> : <button type="submit" disabled={!draft.trim()} aria-label="Send message"><Send size={17} aria-hidden="true" /></button>}
            </form>
            <div className="assistant-footer-note"><span id="assistant-input-note">{draft.length > 1700 ? `${draft.length}/2,000 characters` : "AI can make mistakes. Check details before acting."}</span><Link href="/help/contact">Human support <ArrowRight size={11} aria-hidden="true" /></Link></div>
          </footer>
      </section>
  );
}
