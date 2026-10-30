"use client";

import { useSyncExternalStore } from "react";

// Public payment receipts only. Never store wallet keys or authorization messages.
const memory = new Map<string, string | null>();
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
export function readTransferSession(key: string): string | null {
  if (typeof window === "undefined") return null;
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeTransferSession(key: string, value: unknown | null) {
  const text = value === null ? null : JSON.stringify(value);
  memory.set(key, text);
  try {
    if (text === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, text);
  } catch {
    /* In-memory recovery remains available when storage is blocked. */
  }
  listeners.forEach((listener) => listener());
}
export function useTransferSession(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readTransferSession(key),
    () => null,
  );
}
