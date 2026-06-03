"use client";

import { useAuth } from "@/lib/auth";

export function useRole() {
  const { user, isLoading } = useAuth();

  // If loading, we usually don't want to enforce roles yet to prevent flickering
  // but it depends on the use case.
  const role = user?.role?.toLowerCase() || "";

  const isConsumer = role === "consumer" || role === "buyer" || role === "both";
  const isProvider = role === "provider" || role === "both";
  const isAdmin = role === "admin" || role === "moderator" || role === "superadmin";
  const isDualRole = role === "both";
  
  // A new user is someone who has authenticated but hasn't selected a role
  // If the backend defaults role to 'new' or leaves it empty, we catch that here.
  const isNewUser = !!user && (!role || role === "new" || role === "unassigned");

  return {
    isConsumer,
    isProvider,
    isAdmin,
    isNewUser,
    isDualRole,
    role,
    isLoading
  };
}
