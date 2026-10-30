"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";
import { getRouteLabel, ROUTES } from "@/lib/navigation/routes";

export function Breadcrumbs() {
    const pathname = usePathname();
    const paths = pathname === "/" ? [] : pathname.split("/").filter(Boolean);

    return (
        <nav className="flex items-center space-x-2 text-xs font-mono text-muted-foreground mb-4">
            <Link href={ROUTES.dashboard} className="flex items-center hover:text-primary transition-colors">
                <Home size={12} className="mr-2" />
                SYSTEM
            </Link>

            {paths.slice(1).map((path, index) => {
                const href = `/${paths.slice(0, index + 2).join("/")}`;
                const isLast = index === paths.length - 2;

                return (
                    <div key={path} className="flex items-center space-x-2">
                        <ChevronRight size={10} className="opacity-40" />
                        {isLast ? (
                            <span className="text-primary font-bold">
                                {getRouteLabel(href)}
                            </span>
                        ) : (
                            <Link href={href} className="hover:text-primary transition-colors">
                                {getRouteLabel(href)}
                            </Link>
                        )}
                    </div>
                );
            })}
        </nav>
    );
}
