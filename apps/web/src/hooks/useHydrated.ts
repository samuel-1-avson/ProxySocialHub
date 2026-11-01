"use client";
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
/** Stable server snapshot avoids hydration mismatches without an extra effect. */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
