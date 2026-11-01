"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, Loader2, UserCheck, UserPlus, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/stores";
import { Modal } from "@/components/patterns/Modal";
import { sendFriendRequest, acceptFriendRequest, rejectFriendRequest, cancelFriendRequest, removeFriend, getFriendshipStatus } from "@/lib/friends-api";

type FriendshipStatus = "none" | "friends" | "request_sent" | "request_received" | "loading";
type Friendship = Awaited<ReturnType<typeof getFriendshipStatus>>;
type Action = "add" | "accept" | "decline" | "cancel" | "remove";
interface FriendButtonProps {
  userId: string;
  username: string;
  variant?: "default" | "outline" | "compact";
  onStatusChange?: (status: FriendshipStatus) => void;
}
export function FriendButton({ userId, username, variant = "default", onStatusChange }: FriendButtonProps) {
  const { user, isAuthenticated } = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const [removeOpen, setRemoveOpen] = useState(false);
  const enabled = isAuthenticated && Boolean(userId) && user?.id !== userId;
  const key = ["friendship-status", user?.id, userId];
  const query = useQuery({ queryKey: key, queryFn: () => getFriendshipStatus(userId), enabled, retry: false });
  const action = useMutation({
    retry: false,
    mutationFn: async (type: Action): Promise<Friendship> => {
      const requestId = query.data?.request_id;
      if (type === "add") {
        const result = await sendFriendRequest(userId);
        return { status: "request_sent", request_id: result.id };
      }
      if (type === "remove") { await removeFriend(userId); return { status: "none" }; }
      if (!requestId) throw new Error("Refresh the friendship status before trying again.");
      if (type === "accept") { await acceptFriendRequest(requestId); return { status: "friends" }; }
      if (type === "cancel") await cancelFriendRequest(requestId);
      else await rejectFriendRequest(requestId);
      return { status: "none" };
    },
    onSuccess: (next) => {
      client.setQueryData(key, next);
      setRemoveOpen(false);
      onStatusChange?.(next.status);
      void client.invalidateQueries({ queryKey: ["friends"] });
      void client.invalidateQueries({ queryKey: ["friend-requests"] });
    },
    onError: (failure) => toast.error("Friend action failed", failure.message),
  });
  if (!enabled) return null;
  const compact = variant === "compact";
  const buttonClass = compact ? "ui-button secondary p-2" : "ui-button secondary";
  function control(label: string, type: Action | "confirm", icon: React.ReactNode) {
    return <button type="button" className={buttonClass} disabled={action.isPending} aria-label={label + " · " + username} title={label} onClick={() => type === "confirm" ? setRemoveOpen(true) : action.mutate(type)}>
      {action.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : icon}
      {!compact && label}
    </button>;
  }
  const state = query.data?.status;
  return <>
    {query.isPending ? <button type="button" className={buttonClass} disabled aria-label={"Loading friendship with " + username}><Loader2 size={16} className="animate-spin" aria-hidden /></button>
      : query.isError ? <button type="button" className={buttonClass} title="Friendship status is unavailable" onClick={() => void query.refetch()}>Retry status</button>
      : state === "friends" ? control("Remove friend", "confirm", <UserCheck size={16} aria-hidden />)
      : state === "request_sent" ? control("Cancel request", "cancel", <Clock size={16} aria-hidden />)
      : state === "request_received" ? <span className="inline-flex gap-2">{control("Accept request", "accept", <Check size={16} aria-hidden />)}{control("Decline request", "decline", <X size={16} aria-hidden />)}</span>
      : control("Add friend", "add", <UserPlus size={16} aria-hidden />)}
    <Modal open={removeOpen} onOpenChange={setRemoveOpen} title={"Remove " + username + "?"} description="This removes the friendship. You can send a new request later." size="sm">
      {action.isError && <p className="text-sm text-destructive mb-4" role="alert">{action.error.message}</p>}
      <div className="ui-actions"><button type="button" className="ui-button secondary" onClick={() => setRemoveOpen(false)}>Keep friend</button><button type="button" className="ui-button" disabled={action.isPending} onClick={() => action.mutate("remove")}>{action.isPending ? "Removing…" : "Remove friend"}</button></div>
    </Modal>
  </>;
}
export default FriendButton;
