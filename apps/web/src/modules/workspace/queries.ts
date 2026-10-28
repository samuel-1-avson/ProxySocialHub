"use client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getOrders, marketplaceKeys } from "@/lib/api/marketplace";
import { getSessions } from "@/lib/api/sessions";
import { getUserUsage } from "@/lib/api/usage";

export function useOrders() {
  const { isAuthenticated, user } = useAuth();
  return useQuery({
    queryKey: [...marketplaceKeys.orders(), user?.id],
    queryFn: () => getOrders(),
    enabled: isAuthenticated,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
export function useSessions() {
  const { isAuthenticated, user } = useAuth();
  return useQuery({
    queryKey: ["workspace-sessions", user?.id],
    queryFn: () => getSessions("all"),
    enabled: isAuthenticated,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
export function useUsage() {
  const { isAuthenticated, user } = useAuth();
  return useQuery({
    queryKey: ["workspace-usage", user?.id],
    queryFn: getUserUsage,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });
}
