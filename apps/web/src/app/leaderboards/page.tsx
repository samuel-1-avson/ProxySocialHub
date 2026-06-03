import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/navigation/routes";

/** Legacy URL — canonical leaderboard lives under Explorer. */
export default function LeaderboardsRedirectPage() {
    redirect(ROUTES.explorerLeaderboard);
}
