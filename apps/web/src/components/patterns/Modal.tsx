"use client";

import { useRef, type ReactNode } from "react";
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
          const target = returnFocus.current?.isConnected
            ? returnFocus.current
            : document.getElementById("main-content");
          if (target) {
            event.preventDefault();
            target.focus({ preventScroll: true });
          }
        }}
        data-testid={testId}
        hideCloseButton={hideCloseButton}
        {...(!description ? { "aria-describedby": undefined } : {})}
        className={cn(SIZE_CLASS[size], "gap-0 p-0", className)}
      >
        <DialogHeader className="border-b border-border px-6 py-4 text-left">
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className={cn("px-6 py-5", contentClassName)}>{children}</div>
        {footer ? (
          <DialogFooter className="border-t border-border px-6 py-4 sm:justify-end">
            {footer}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
