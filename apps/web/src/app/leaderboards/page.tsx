import { redirect } from "next/navigation";
import { explorerHref } from "@/lib/navigation/workspace";

/** Legacy URL — canonical leaderboard lives under Explorer. */
export default function LeaderboardsRedirectPage() {
    redirect(explorerHref("/nodes?view=rankings"));
}
