"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ArrowUpRight, MessageCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const HubbieDrawer = dynamic(() => import("./HubbieDrawer"), {
  ssr: false,
  loading: () => <div className="hubbie-drawer-loading" role="status">Opening Hubbie…</div>,
});
const HubbieContext = createContext<{ isOpen: boolean; openHubbie: () => void } | null>(null);
const emptyPanel = { owner: "", open: false, loaded: false, unread: false };

/** Root-owned tab memory survives page navigation, never a change of account. */
export function HubbieProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const pathname = usePathname();
  const owner = user?.id || "";
  const allowed = isAuthenticated && !/^\/(login|register)(?:\/|$)/.test(pathname);
  const [panel, setPanel] = useState(emptyPanel);
  const trigger = useRef<HTMLElement | null>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const openRef = useRef(false);
  const isOpen = allowed && panel.owner === owner && panel.open;

  // Reset before committing UI for a different account; no shared chat survives.
  if (panel.owner !== owner) setPanel({ ...emptyPanel, owner });
  useEffect(() => { openRef.current = isOpen; }, [isOpen]);

  const openHubbie = useCallback(() => {
    if (!allowed || !owner) return;
    trigger.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    openRef.current = true;
    setPanel({ owner, open: true, loaded: true, unread: false });
  }, [allowed, owner]);
  const setOpen = useCallback((open: boolean) => {
    openRef.current = open;
    setPanel((previous) => ({ ...previous, open, unread: open ? false : previous.unread }));
  }, []);
  const notifyReply = useCallback(() => {
    if (!openRef.current) setPanel((previous) => previous.owner === owner ? { ...previous, unread: true } : previous);
  }, [owner]);
  const restoreFocus = useCallback(() => {
    requestAnimationFrame(() => {
      const target = trigger.current?.isConnected ? trigger.current : launcher.current;
      target?.focus({ preventScroll: true });
    });
  }, []);
  const value = useMemo(() => ({ isOpen, openHubbie }), [isOpen, openHubbie]);

  return (
    <HubbieContext.Provider value={value}>
      <div className="hubbie-host" data-hubbie-open={isOpen}>
        <div className="hubbie-page-content">{children}</div>
        {allowed && <button ref={launcher} type="button" className="hubbie-launcher" hidden={isOpen}
          aria-label={panel.unread && panel.owner === owner ? "Open Hubbie AI assistant, new reply" : "Open Hubbie AI assistant"}
          aria-haspopup="dialog" aria-expanded={isOpen} aria-controls="hubbie-drawer" onClick={openHubbie}>
          <span className="hubbie-launcher-symbol"><MessageCircle size={21} strokeWidth={1.7} aria-hidden="true" /><span className="hubbie-launcher-signal" /></span>
          <span>Hubbie</span><span className="hubbie-ai-badge">AI</span><ArrowUpRight size={14} aria-hidden="true" />
          {panel.unread && panel.owner === owner && <span className="hubbie-unread" aria-hidden="true" />}
        </button>}
        {allowed && panel.owner === owner && panel.loaded && <ErrorBoundary key={owner} level="component" fallback={
          <>{isOpen ? <div className="hubbie-drawer-loading" role="alert"><div><p>Hubbie couldn’t load. Try opening it again.</p><button type="button" className="ui-btn ui-btn-secondary mt-3" onClick={() => { setPanel({ ...emptyPanel, owner }); restoreFocus(); }}>Close Hubbie</button></div></div> : null}</>
        }><HubbieDrawer open={isOpen} onOpenChange={setOpen} onReply={notifyReply} restoreFocus={restoreFocus} /></ErrorBoundary>}
      </div>
    </HubbieContext.Provider>
  );
}

export function useHubbie() {
  const value = useContext(HubbieContext);
  if (!value) throw new Error("Hubbie controls require HubbieProvider.");
  return value;
}
