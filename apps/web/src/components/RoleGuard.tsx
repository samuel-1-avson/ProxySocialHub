"use client";

import React from "react";
import { useRole } from "@/hooks/useRole";

interface RoleGuardProps {
    children: React.ReactNode;
    fallback?: React.ReactNode;
}

export function ForProvider({ children, fallback = null }: RoleGuardProps) {
    const { isProvider, isLoading } = useRole();
    if (isLoading) return null; // or a skeleton
    return isProvider ? <>{children}</> : <>{fallback}</>;
}

export function ForConsumer({ children, fallback = null }: RoleGuardProps) {
    const { isConsumer, isLoading } = useRole();
    if (isLoading) return null;
    return isConsumer ? <>{children}</> : <>{fallback}</>;
}

export function ForNewUser({ children, fallback = null }: RoleGuardProps) {
    const { isNewUser, isLoading } = useRole();
    if (isLoading) return null;
    return isNewUser ? <>{children}</> : <>{fallback}</>;
}

export function ForDualRole({ children, fallback = null }: RoleGuardProps) {
    const { isDualRole, isLoading } = useRole();
    if (isLoading) return null;
    return isDualRole ? <>{children}</> : <>{fallback}</>;
}

export function ForAdmin({ children, fallback = null }: RoleGuardProps) {
    const { isAdmin, isLoading } = useRole();
    if (isLoading) return null;
    return isAdmin ? <>{children}</> : <>{fallback}</>;
}
