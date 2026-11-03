"use client";

import { useRef, type ReactNode, type RefObject } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ModalSize = "sm" | "md" | "lg" | "xl";

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
};

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  /** Hide the default top-right close control when a custom footer handles dismiss. */
  hideCloseButton?: boolean;
  className?: string;
  contentClassName?: string;
  /** Test id on the dialog content */
  testId?: string;
  /** Explicit trigger for dialogs opened after an asynchronous action. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Canonical accessible modal — reconstruction plan §14.2 / §5 C-05.
 * Built on Radix Dialog (focus trap, Escape, aria-modal).
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  hideCloseButton = false,
  className,
  contentClassName,
  testId,
  returnFocusRef,
}: ModalProps) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={() => {
          // Programmatically opened dialogs have no Radix Trigger to restore.
          returnFocus.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        }}
        onCloseAutoFocus={(event) => {
          const trigger = returnFocusRef?.current ?? returnFocus.current;
          const target = trigger?.isConnected
            ? trigger
            : document.getElementById("main-content");
          if (target) {
            event.preventDefault();
            target.focus({ preventScroll: true });
          }
        }}
        data-testid={testId}
        hideCloseButton={hideCloseButton}
        {...(!description ? { "aria-describedby": undefined } : {})}
        className={cn(SIZE_CLASS[size], "flex flex-col gap-0 overflow-hidden p-0", className)}
      >
        <DialogHeader
          className={cn(
            "shrink-0 border-b border-border px-5 py-5 text-left sm:px-6",
            !hideCloseButton && "pr-16 sm:pr-16",
          )}
        >
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div
          className={cn(
            "min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6",
            contentClassName,
          )}
        >
          {children}
        </div>
        {footer ? (
          <DialogFooter className="shrink-0 border-t border-border px-5 py-4 sm:justify-end sm:px-6">
            {footer}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
