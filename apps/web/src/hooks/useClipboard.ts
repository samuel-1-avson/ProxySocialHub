"use client";
import { useState } from "react";
/** Clipboard feedback must reflect a completed browser operation. */
export function useClipboard() {
  const [feedback, setFeedback] = useState("");
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback("Copied to clipboard.");
    } catch {
      setFeedback("Clipboard unavailable. Select and copy the value manually.");
    }
  }
  return { copy, feedback };
}
