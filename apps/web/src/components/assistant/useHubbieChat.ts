"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getAccessTokenSilently, useAuth } from "@/lib/auth";
import type { AssistantEvent, AssistantMessage, AssistantReply, AssistantStep } from "@/lib/assistant";

interface ChatEntry extends AssistantMessage { id: number; reply?: AssistantReply }

export function useHubbieChat(onReply?: () => void) {
  const pathname = usePathname();
  const { user, isAuthenticated } = useAuth();
  const [mode, setMode] = useState<"ai" | "guides" | null>(null);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [steps, setSteps] = useState<AssistantStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");
  const abort = useRef<AbortController | null>(null);
  const active = useRef(false);
  const serial = useRef(0);
  const identity = user?.id ?? "guest";
  const identityRef = useRef(identity);
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

  function clear() {
    abort.current?.abort(); setMessages([]); setDraft(""); setError(null); setSteps([]); setLiveText("");
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
      if (event.type === "step") { setSteps((previous) => [...previous, event.step]); setLiveText(""); }
      if (event.type === "delta") setLiveText((previous) => previous + event.text);
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "reply") {
        receivedReply = true;
        setLiveText("");
        onReply?.();
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
      setBusy(false); setStatus(""); setSteps([]); setLiveText("");
    }
  }

  const stop = () => abort.current?.abort();
  return { user, isAuthenticated, messages, draft, setDraft, busy, status, steps, error, mode, liveText, input, clear, send, stop };
}
export type HubbieChat = ReturnType<typeof useHubbieChat>;
