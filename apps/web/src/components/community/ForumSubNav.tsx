"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { MessageSquare, Clock, Trophy, HelpCircle, PenLine } from "lucide-react";
import { ROUTES } from "@/lib/navigation/routes";

const FORUM_LINKS = [
    { href: ROUTES.communityForum, label: "All", icon: MessageSquare, query: {} },
    { href: ROUTES.communityForumRecent, label: "Recent", icon: Clock, query: { sort: "recent" } },
    { href: ROUTES.communityForumPopular, label: "Popular", icon: Trophy, query: { sort: "popular" } },
    { href: ROUTES.communityForumUnanswered, label: "Unanswered", icon: HelpCircle, query: { filter: "unanswered" } },
    { href: ROUTES.communityForumMyPosts, label: "My posts", icon: PenLine, query: { filter: "mine" } },
] as const;

function isForumLinkActive(pathname: string, search: string, href: string) {
    const normalized = pathname.replace(/\/$/, "") || "/";
    const target = href.split(/[?#]/)[0].replace(/\/$/, "") || "/";
    if (normalized !== target && !normalized.startsWith(`${target}/`)) return false;
    const hrefQuery = new URLSearchParams(href.split("?")[1] || "");
    const currentQuery = new URLSearchParams(search);
    if (!hrefQuery.size) {
        return !currentQuery.has("sort") && !currentQuery.has("filter");
    }
    return [...hrefQuery].every(([key, value]) => currentQuery.get(key) === value);
}

function ForumSubNavContent() {
    const pathname = usePathname() ?? "";
    const searchParams = useSearchParams();

    return (
        <nav
            aria-label="Forum sections"
            className="flex flex-wrap gap-2 border-b border-border pb-4 mb-6"
        >
            {FORUM_LINKS.map((link) => {
                const { href, label, icon: Icon } = link;
                const active = isForumLinkActive(pathname, searchParams.toString(), href);
                return (
                    <Link
                        key={href}
                        href={href}
                        prefetch={false}
                        className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-mono font-bold uppercase tracking-wide transition-colors ${
                            active
                                ? "bg-primary text-primary-foreground"
                                : "bg-secondary/30 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                        }`}
                    >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                    </Link>
                );
            })}
        </nav>
    );
}

export function ForumSubNav() {
    return (
        <Suspense fallback={<nav aria-label="Forum sections" className="mb-6 h-10 border-b border-border" />}>
            <ForumSubNavContent />
        </Suspense>
    );
}
