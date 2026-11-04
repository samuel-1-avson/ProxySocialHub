"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useSyncExternalStore } from "react";
import HubbieAssistant from "./HubbieAssistant";
import { useHubbieChat } from "./useHubbieChat";

const compactQuery = "(max-width: 767px)";
function subscribeViewport(notify: () => void) {
  const query = window.matchMedia(compactQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

export default function HubbieDrawer({ open, onOpenChange, onReply, restoreFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; onReply: () => void; restoreFocus: () => void;
}) {
  // The controller is outside the portal: dismissing the drawer preserves chat
  // and a pending reply. The account-keyed runtime unmounts on logout/switch.
  const chat = useHubbieChat(onReply);
  const compact = useSyncExternalStore(subscribeViewport, () => window.matchMedia(compactQuery).matches, () => true);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = content.current;
    if (!element || !open || !compact) return;
    const viewport = window.visualViewport;
    const sync = () => {
      element.style.setProperty("--hubbie-visible-height", `${viewport?.height ?? window.innerHeight}px`);
      element.style.setProperty("--hubbie-top", `${viewport?.offsetTop ?? 0}px`);
    };
    sync();
    viewport?.addEventListener("resize", sync);
    viewport?.addEventListener("scroll", sync);
    return () => {
      viewport?.removeEventListener("resize", sync);
      viewport?.removeEventListener("scroll", sync);
      element.style.removeProperty("--hubbie-visible-height");
      element.style.removeProperty("--hubbie-top");
    };
  }, [open, compact]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={compact}>
      <Dialog.Portal>
        {compact && <Dialog.Overlay className="hubbie-drawer-overlay" />}
        <Dialog.Content ref={content} id="hubbie-drawer" className="hubbie-drawer" aria-modal={compact ? true : undefined}
          onOpenAutoFocus={(event) => { event.preventDefault(); chat.input.current?.focus({ preventScroll: true }); }}
          onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}
          onInteractOutside={(event) => { if (!compact) event.preventDefault(); }}>
          <Dialog.Title className="sr-only">Hubbie AI assistant</Dialog.Title>
          <Dialog.Description className="sr-only">Your personal account assistant. Chat while you browse ProxyHubb. Close the panel to minimize it; your conversation stays in this tab.</Dialog.Description>
          <HubbieAssistant chat={chat} onClose={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
