"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useHubbie } from "./HubbieProvider";

/** Preserve existing bookmarks while moving normal usage into the dock. */
export function HubbieEntry() {
  const { openHubbie } = useHubbie();
  const router = useRouter();
  useEffect(() => { openHubbie(); router.replace("/app"); }, [openHubbie, router]);
  return <p className="ui-loading" role="status">Opening Hubbie in your workspace…</p>;
}
