"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Clock, Trophy, HelpCircle, PenLine } from "lucide-react";
import { ROUTES } from "@/lib/navigation/routes";

const FORUM_LINKS = [
    { href: ROUTES.communityForum, label: "All", icon: MessageSquare, exact: true },
    { href: ROUTES.communityForumRecent, label: "Recent", icon: Clock },
    { href: ROUTES.communityForumPopular, label: "Popular", icon: Trophy },
    { href: ROUTES.communityForumUnanswered, label: "Unanswered", icon: HelpCircle },
    { href: ROUTES.communityForumMyPosts, label: "My posts", icon: PenLine },
] as const;

function isForumLinkActive(pathname: string, href: string, exact?: boolean) {
    const normalized = pathname.replace(/\/$/, "") || "/";
    const target = href.replace(/\/$/, "") || "/";
    if (exact) return normalized === target;
    return normalized === target || normalized.startsWith(`${target}/`);
}

export function ForumSubNav() {
    const pathname = usePathname() ?? "";

    return (
        <nav
            aria-label="Forum sections"
            className="flex flex-wrap gap-2 border-b border-border pb-4 mb-6"
        >
            {FORUM_LINKS.map(({ href, label, icon: Icon, exact }) => {
                const active = isForumLinkActive(pathname, href, exact);
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
