"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getIdentity, isAuthenticated, logout as authLogout } from "@/lib/auth";
import type { AdminIdentity } from "@/lib/auth";

export function useAdminAuth() {
  const router = useRouter();
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }
    setIdentity(getIdentity());
    setLoading(false);
  }, [router]);

  const logout = useCallback(async () => {
    await authLogout();
    // Clear the cookie used by middleware
    document.cookie = "admin_token=; Max-Age=0; path=/";
    router.replace("/login");
  }, [router]);

  return { identity, loading, logout };
}
