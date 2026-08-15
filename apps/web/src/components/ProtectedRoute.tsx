"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { isRoleAllowedForPolicy } from "@/lib/navigation/policies";

interface ProtectedRouteProps {
    children: React.ReactNode;
    requireAuth?: boolean;
    requiredRole?: "buyer" | "provider" | "admin";
}

export function ProtectedRoute({ children, requireAuth = true, requiredRole }: ProtectedRouteProps) {
    const { user, isLoading, isAuthenticated } = useAuth();
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (requireAuth && !isLoading && !isAuthenticated) {
            // Redirect to login with return URL
            router.push(`/login?redirect=${encodeURIComponent(pathname || "/")}`);
        }
    }, [requireAuth, isLoading, isAuthenticated, router, pathname]);

    useEffect(() => {
        // Check role if required
        if (requireAuth && !isLoading && isAuthenticated && requiredRole && !isRequiredRoleAllowed(user?.role, requiredRole)) {
            if (requiredRole === "provider") {
                router.push("/403?policy=provider");
            } else if (requiredRole === "admin") {
                router.push("/403?policy=admin");
            }
        }
    }, [requireAuth, isLoading, isAuthenticated, requiredRole, user, router]);

    // Show loading state
    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
                <div className="text-center">
                    <div className="spinner mx-auto mb-4" style={{ width: 40, height: 40 }}></div>
                    <p style={{ color: "var(--muted-foreground)" }}>Loading...</p>
                </div>
            </div>
        );
    }

    if (!requireAuth) {
        return <>{children}</>;
    }

    // Not authenticated, will redirect
    if (!isAuthenticated) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
                <div className="text-center">
                    <p style={{ color: "var(--muted-foreground)" }}>Redirecting to login...</p>
                </div>
            </div>
        );
    }

    // Wrong role
    if (requiredRole && !isRequiredRoleAllowed(user?.role, requiredRole)) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
                <div className="text-center">
                    <p style={{ color: "var(--error)" }}>Access denied. {requiredRole} role required.</p>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}

// HOC for protecting pages
export function withAuth<P extends object>(
    Component: React.ComponentType<P>,
    requiredRole?: "buyer" | "provider" | "admin"
) {
    return function ProtectedComponent(props: P) {
        return (
            <ProtectedRoute requireAuth requiredRole={requiredRole}>
                <Component {...props} />
            </ProtectedRoute>
        );
    };
}

export default ProtectedRoute;

function isRequiredRoleAllowed(role: string | undefined, requiredRole: "buyer" | "provider" | "admin") {
    if (requiredRole === "provider") return isRoleAllowedForPolicy(role, "provider");
    if (requiredRole === "admin") return isRoleAllowedForPolicy(role, "admin");

    const normalizedRole = role?.trim().toLowerCase();
    return normalizedRole === "buyer" || normalizedRole === "consumer" || normalizedRole === "both" || normalizedRole === "admin";
}
