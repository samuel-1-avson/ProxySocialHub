"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { ArrowDown, ArrowRight, Check, CircleHelp, MessageCircle, RotateCcw, Send, ShieldCheck, Square } from "lucide-react";
import { getAccessTokenSilently, useAuth } from "@/lib/auth";
import { safeAssistantHref, type AssistantEvent, type AssistantMessage, type AssistantReply, type AssistantStep } from "@/lib/assistant";

interface ChatEntry extends AssistantMessage { id: number; reply?: AssistantReply }
const PROMPTS = [
  { label: "Find a proxy", text: "Help me find a proxy. What should I compare before buying?" },
  { label: "Check my orders", text: "Check my recent orders and help me understand their status." },
  { label: "Fix a connection", text: "My proxy is not connecting. Help me troubleshoot it." },
  { label: "Become a provider", text: "How do I start providing bandwidth on ProxyHubb?" },
];

export default function HubbieAssistant() {
  const pathname = usePathname();
  const { user, isAuthenticated } = useAuth();
  const [mode, setMode] = useState<"ai" | "guides" | null>(null);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [steps, setSteps] = useState<AssistantStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const active = useRef(false);
  const serial = useRef(0);
  const identity = user?.id ?? "guest";
  const identityRef = useRef(identity);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await getAccessTokenSilently();
        if (!token || controller.signal.aborted) return;
        const response = await fetch("/api/assistant", { signal: controller.signal, cache: "no-store", headers: { authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error("Your assistant session could not be verified. Sign in again or try shortly.");
        const value = await response.json();
        if (value.mode === "ai" || value.mode === "guides") setMode(value.mode);
      } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Hubbie could not be reached."); }
    })();
    return () => controller.abort();
  }, [isAuthenticated, identity]);
  useEffect(() => {
    if (identityRef.current !== identity) {
      abort.current?.abort();
      identityRef.current = identity;
      setMessages([]); setDraft(""); setError(null); setSteps([]);
    }
  }, [identity]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { if (messages.length || busy) end.current?.scrollIntoView({ behavior: "instant", block: "nearest" }); }, [messages, steps, busy]);

  function clear() {
    abort.current?.abort(); setMessages([]); setDraft(""); setError(null); setSteps([]);
    input.current?.focus();
  }

  async function send(text: string, retry = false) {
    const content = text.trim();
    if (!content || !isAuthenticated || active.current || content.length > 2000) return;
    const controller = new AbortController();
    abort.current = controller;
    active.current = true;
    const requestIdentity = identityRef.current;
    const history = retry ? messages : [...messages, { id: ++serial.current, role: "user" as const, content }];
    if (!retry) setMessages(history);
    setDraft(""); setError(null); setSteps([]); setBusy(true); setStatus("Working on your request");
    let receivedReply = false;
    const receive = (event: AssistantEvent) => {
      if (controller.signal.aborted || requestIdentity !== identityRef.current) return;
      if (event.type === "status") setStatus(event.label);
      if (event.type === "step") setSteps((previous) => [...previous, event.step]);
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "reply") {
        receivedReply = true;
        setMessages((previous) => [...previous, { id: ++serial.current, role: "assistant", content: event.reply.content, reply: event.reply }]);
      }
    };
    try {
      const token = isAuthenticated ? await getAccessTokenSilently() : null;
      if (isAuthenticated && !token) throw new Error("Your session expired. Sign in again to check your account.");
      if (controller.signal.aborted) return;
      // Retain bounded text context only. Tool calls and results are always server-owned.
      const context: AssistantMessage[] = [];
      let length = 0;
      for (const message of [...history].reverse().slice(0, 12)) {
        const value = message.content.slice(0, 4000);
        if (length + value.length > 18000) break;
        context.unshift({ role: message.role, content: value }); length += value.length;
      }
      const response = await fetch("/api/assistant", {
        method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ messages: context, pathname }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        throw new Error(typeof failure?.error === "string" ? failure.error : "The assistant could not answer. Try again shortly.");
      }
      if (response.headers.get("content-type")?.includes("application/json")) {
        receive({ type: "reply", reply: await response.json() as AssistantReply });
      } else {
        const reader = response.body?.getReader();
        if (!reader) throw new Error("The answer stream could not be opened.");
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            let newline: number;
            while ((newline = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
              if (line.trim()) receive(JSON.parse(line) as AssistantEvent);
            }
          }
          buffer += decoder.decode();
          if (buffer.trim()) receive(JSON.parse(buffer) as AssistantEvent);
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      }
      if (!receivedReply && !controller.signal.aborted) throw new Error("The answer was interrupted. Try again.");
    } catch (caught) {
      if (!controller.signal.aborted && requestIdentity === identityRef.current) setError(caught instanceof Error ? caught.message : "The assistant could not answer. Please try again.");
    } finally {
      active.current = false;
      setBusy(false); setStatus(""); setSteps([]);
    }
  }
  const guideMode = mode === "guides" || !isAuthenticated;
  const last = messages[messages.length - 1];
  function submit(event: FormEvent) { event.preventDefault(); void send(draft); }

  if (!isAuthenticated) return <p>Sign in to your account to talk with Hubbie.</p>;
  const accountName = (user?.display_name || user?.username || "your account").slice(0, 48);
  return (
    <div className="hubbie-workspace">
      <section className="assistant-panel" aria-label="Hubbie personal assistant">
          <header className="assistant-header">
            <span className="assistant-mark"><MessageCircle size={22} strokeWidth={1.6} aria-hidden="true" /></span>
            <div>
              <h2>Hubbie</h2>
              <p className="assistant-mode"><span />{mode === null ? "Checking availability" : guideMode ? "Help guides" : "Meta AI · Platform tools"}</p>
            </div>
            <div className="assistant-header-actions">
              <button type="button" onClick={clear} aria-label="Start a new conversation" title="New conversation"><RotateCcw size={16} aria-hidden="true" /></button>
            </div>
          </header>
          <p className="sr-only">Your personal ProxyHubb assistant. Ask platform questions, find proxy listings, and check your own orders or provider nodes. Review transactions in your wallet.</p>
          <div className="assistant-context"><ShieldCheck size={14} aria-hidden="true" /><span>You review every payment and account change.</span></div>
          <div className="assistant-conversation" role="log" aria-label="Hubbie conversation" aria-live="polite" aria-relevant="additions" aria-busy={busy}>
            {!messages.length && (
              <div className="assistant-welcome">
                <span className="assistant-eyebrow">Here for your next step</span>
                <h2>Hi, I’m Hubbie.<br />How can I help?</h2>
                <p>Find the right proxy, understand an order, or get your provider node running.</p>
                <div className="assistant-prompts">
                  {PROMPTS.map((prompt) => <button type="button" key={prompt.label} disabled={busy} onClick={() => void send(prompt.text)}>{prompt.label}<ArrowRight size={15} aria-hidden="true" /></button>)}
                </div>
                <div className="assistant-privacy"><CircleHelp size={15} aria-hidden="true" /><p>Chat stays in this tab’s memory. For live AI, Meta receives your messages and the account summaries it requests. Keep passwords, keys, and seed phrases out of chat.</p></div>
              </div>
            )}
            {messages.map((message) => (
              <article key={message.id} className={`assistant-message assistant-message-${message.role}`} aria-label={message.role === "user" ? "You" : "Hubbie"}>
                <p className="assistant-message-label">{message.role === "user" ? "You" : message.reply?.mode === "guides" ? "Hubbie · Help guides" : "Hubbie"}</p>
                {message.reply?.steps.length ? <div className="assistant-steps">{message.reply.steps.map((step, i) => <p key={i}>{step.ok ? <Check size={12} aria-hidden="true" /> : <CircleHelp size={12} aria-hidden="true" />}{step.label}</p>)}</div> : null}
                <div className="assistant-markdown">
                  <ReactMarkdown components={{ a: ({ href, children }) => href && safeAssistantHref(href) ? <a href={href} target={href.startsWith("https:") ? "_blank" : undefined} rel="noopener noreferrer">{children}</a> : <span>{children}</span>, img: () => null }}>{message.content}</ReactMarkdown>
                </div>
                {message.reply?.sources.length ? <div className="assistant-sources" aria-label="Sources and next steps">{message.reply.sources.filter((source) => safeAssistantHref(source.href)).map((source) => <a key={source.href} href={source.href} target={source.href.startsWith("https:") ? "_blank" : undefined} rel="noopener noreferrer">{source.title}<ArrowRight size={13} aria-hidden="true" /></a>)}</div> : null}
              </article>
            ))}
            {busy && <div className="assistant-working" role="status"><div className="assistant-steps">{steps.map((step, i) => <p key={i}>{step.ok ? <Check size={12} aria-hidden="true" /> : <CircleHelp size={12} aria-hidden="true" />}{step.label}</p>)}</div><p><span className="assistant-working-dot" />{status || "Working on your request"}</p></div>}
            <div ref={end} />
          </div>
          {error && <div className="assistant-error" role="alert"><p>{error}</p>{last?.role === "user" && !busy && <button type="button" onClick={() => void send(last.content, true)}>Try again <ArrowDown size={13} aria-hidden="true" /></button>}</div>}
          <footer className="assistant-footer">
            {guideMode && <p className="assistant-guide-note">{!isAuthenticated ? <><Link href={`/login?next=${encodeURIComponent(pathname)}`}>Sign in</Link> for live AI and account checks. </> : "Live AI is not enabled on this server. "}Guide answers do not check live data.</p>}
            {busy ? null : last?.role === "user" && !error && <p className="assistant-guide-note">Request stopped. <button type="button" onClick={() => void send(last.content, true)}>Try again</button></p>}
            <form onSubmit={submit} className="assistant-composer">
              <label htmlFor="assistant-question" className="sr-only">Your question</label>
              <textarea ref={input} id="assistant-question" value={draft} maxLength={2000} rows={2} placeholder="Ask Hubbie about your next step…" disabled={busy} aria-describedby="assistant-input-note"
                onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); } }} />
              {busy ? <button type="button" onClick={() => abort.current?.abort()} aria-label="Stop response"><Square size={15} fill="currentColor" aria-hidden="true" /></button> : <button type="submit" disabled={!draft.trim()} aria-label="Send message"><Send size={17} aria-hidden="true" /></button>}
            </form>
            <div className="assistant-footer-note"><span id="assistant-input-note">{draft.length > 1700 ? `${draft.length}/2,000 characters` : "AI can make mistakes. Check details before acting."}</span><Link href="/help/contact">Human support <ArrowRight size={11} aria-hidden="true" /></Link></div>
          </footer>
      </section>
      <aside className="hubbie-account-context" aria-label="Hubbie account scope">
        <p className="assistant-eyebrow">Personal to your account</p>
        <h2>{accountName}</h2>
        <p>Hubbie works with your signed-in account. Other users’ private data is outside its access.</p>
        <div className="hubbie-context-section">
          <ShieldCheck size={18} aria-hidden="true" />
          <h3>You stay in control</h3>
          <p>Hubbie can read recent order and node summaries, search listings, and prepare your next step. You review payments, signatures, and account changes yourself.</p>
        </div>
        <div className="hubbie-context-section">
          <MessageCircle size={18} aria-hidden="true" />
          <h3>A private workspace</h3>
          <p>Chat is held in this page’s memory and cleared when you leave, reload, or change accounts. Meta receives chat text and requested summaries for live AI. Credentials and private network addresses are excluded from account tools.</p>
        </div>
        <Link href="/help/contact" className="ui-link">Contact the team <ArrowRight size={13} aria-hidden="true" /></Link>
      </aside>
    </div>
  );
}
