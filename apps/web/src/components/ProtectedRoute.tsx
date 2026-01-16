"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";

interface ProtectedRouteProps {
    children: React.ReactNode;
    requiredRole?: "buyer" | "provider" | "admin";
}

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
    const { user, isLoading, isAuthenticated } = useAuth();
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            // Redirect to login with return URL
            router.push(`/login?redirect=${encodeURIComponent(pathname || "/")}`);
        }
    }, [isLoading, isAuthenticated, router, pathname]);

    useEffect(() => {
        // Check role if required
        if (!isLoading && isAuthenticated && requiredRole && user?.role !== requiredRole) {
            // User doesn't have required role
            if (requiredRole === "provider" && user?.role === "buyer") {
                router.push("/dashboard?error=provider_required");
            } else if (requiredRole === "admin" && user?.role !== "admin") {
                router.push("/dashboard?error=admin_required");
            }
        }
    }, [isLoading, isAuthenticated, requiredRole, user, router]);

    // Show loading state
    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
                <div className="text-center">
                    <div className="spinner mx-auto mb-4" style={{ width: 40, height: 40 }}></div>
                    <p style={{ color: "var(--muted)" }}>Loading...</p>
                </div>
            </div>
        );
    }

    // Not authenticated, will redirect
    if (!isAuthenticated) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
                <div className="text-center">
                    <p style={{ color: "var(--muted)" }}>Redirecting to login...</p>
                </div>
            </div>
        );
    }

    // Wrong role
    if (requiredRole && user?.role !== requiredRole) {
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
            <ProtectedRoute requiredRole={requiredRole}>
                <Component {...props} />
            </ProtectedRoute>
        );
    };
}

export default ProtectedRoute;
