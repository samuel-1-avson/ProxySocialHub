"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, MessageSquare, UserMinus, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  getFriends,
  getFriendRequests,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  removeFriend,
} from "@/lib/friends-api";
import { PeopleYouMayKnow } from "@/components/PeopleYouMayKnow";
import { messageRecipientHref } from "@/lib/messaging/social-messaging";
import { Modal } from "@/components/patterns/Modal";
import {
  DataError,
  EmptyState,
  Loading,
  PageHeading,
} from "@/components/workspace/Patterns";
type Action = { kind: "accept" | "reject" | "cancel" | "remove"; id: string };
export default function FriendsPage() {
  const { user, isAuthenticated } = useAuth();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [remove, setRemove] = useState<{ id: string; name: string } | null>(
    null,
  );
  const friends = useQuery({
    queryKey: ["friends", user?.id],
    queryFn: getFriends,
    enabled: isAuthenticated,
  });
  const requests = useQuery({
    queryKey: ["friend-requests", user?.id],
    queryFn: getFriendRequests,
    enabled: isAuthenticated,
  });
  const action = useMutation({
    retry: false,
    mutationFn: ({ kind, id }: Action) =>
      kind === "accept"
        ? acceptFriendRequest(id)
        : kind === "reject"
          ? rejectFriendRequest(id)
          : kind === "cancel"
            ? cancelFriendRequest(id)
            : removeFriend(id),
    onSuccess: () => {
      setRemove(null);
      void client.invalidateQueries({ queryKey: ["friends"] });
      void client.invalidateQueries({ queryKey: ["friend-requests"] });
    },
  });
  const busy = (id: string) => action.isPending && action.variables.id === id;
  const filtered = (friends.data?.friends ?? []).filter((item) =>
    (item.friend?.display_name || item.friend?.username || item.friend_id)
      .toLowerCase()
      .includes(search.toLowerCase().trim()),
  );
  if (!isAuthenticated)
    return (
      <EmptyState
        title="Your community connections"
        description="Sign in to manage friends and requests."
        href="/login?redirect=/community/friends"
        action="Sign in"
      />
    );
  return (
    <div className="ui-page friends-page" data-testid="community-friends">
      <PageHeading
        eyebrow="Community / Connections"
        title="Friends network"
        description="Stay connected with the people you work with. Review requests before accepting a connection."
      />
      {action.isError && (
        <DataError
          title="The connection was not changed"
          error={action.error}
        />
      )}
      <div className="friends-layout">
        <div className="ui-page">
          <section className="ui-surface friends-panel">
            <div className="ui-section-heading">
              <h2>Friend requests</h2>
            </div>
            {requests.isPending ? (
              <Loading label="Loading friend requests…" />
            ) : requests.isError ? (
              <DataError
                error={requests.error}
                retry={() => void requests.refetch()}
              />
            ) : (
              <>
                <h3>Incoming · {requests.data.incoming.length}</h3>
                {!requests.data.incoming.length ? (
                  <p className="ui-subtle">No incoming requests returned.</p>
                ) : (
                  <ul className="friends-list">
                    {requests.data.incoming.map((request) => (
                      <li key={request.id}>
                        <Link
                          className="ui-link"
                          href={
                            "/profile/" +
                            encodeURIComponent(
                              request.sender?.username || request.sender_id,
                            )
                          }
                        >
                          {request.sender?.display_name ||
                            request.sender?.username ||
                            "Community member"}
                        </Link>
                        <div className="ui-actions">
                          <button
                            type="button"
                            className="ui-button small secondary"
                            disabled={busy(request.id)}
                            onClick={() =>
                              action.mutate({ kind: "accept", id: request.id })
                            }
                          >
                            <Check size={14} />
                            Accept
                          </button>
                          <button
                            type="button"
                            className="ui-button small ghost"
                            disabled={busy(request.id)}
                            onClick={() =>
                              action.mutate({ kind: "reject", id: request.id })
                            }
                          >
                            <X size={14} />
                            Decline
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <h3>Outgoing · {requests.data.outgoing.length}</h3>
                {!requests.data.outgoing.length ? (
                  <p className="ui-subtle">No outgoing requests returned.</p>
                ) : (
                  <ul className="friends-list">
                    {requests.data.outgoing.map((request) => (
                      <li key={request.id}>
                        <Link
                          className="ui-link"
                          href={
                            "/profile/" +
                            encodeURIComponent(
                              request.receiver?.username || request.receiver_id,
                            )
                          }
                        >
                          {request.receiver?.display_name ||
                            request.receiver?.username ||
                            "Community member"}
                        </Link>
                        <button
                          type="button"
                          className="ui-button small ghost"
                          disabled={busy(request.id)}
                          onClick={() =>
                            action.mutate({ kind: "cancel", id: request.id })
                          }
                        >
                          Cancel request
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
          <section className="ui-surface friends-panel">
            <div className="ui-section-heading">
              <h2>Your friends</h2>
              <span className="ui-subtle">
                {friends.data?.friends.length ?? "…"} connections
              </span>
            </div>
            <label className="ui-field">
              Search friends
              <input
                className="ui-input"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name"
              />
            </label>
            {friends.isPending ? (
              <Loading label="Loading friends…" />
            ) : friends.isError ? (
              <DataError
                error={friends.error}
                retry={() => void friends.refetch()}
              />
            ) : !filtered.length ? (
              <EmptyState
                title={search ? "No matching friends" : "No connections yet"}
                description={
                  search
                    ? "Try a different name."
                    : "Accepted connections will appear here."
                }
              />
            ) : (
              <ul className="friends-list">
                {filtered.map((item) => {
                  const name =
                    item.friend?.display_name ||
                    item.friend?.username ||
                    "Community member";
                  return (
                    <li key={item.id}>
                      <div className="friends-person">
                        <span aria-hidden="true">{name.slice(0, 1)}</span>
                        <div>
                          <Link
                            className="ui-link"
                            href={
                              "/profile/" +
                              encodeURIComponent(
                                item.friend?.username || item.friend_id,
                              )
                            }
                          >
                            {name}
                          </Link>
                          <p>
                            {item.friend?.username
                              ? "@" + item.friend.username
                              : "Connection"}
                          </p>
                        </div>
                      </div>
                      <div className="ui-actions">
                        <Link
                          className="ui-button small secondary"
                          href={messageRecipientHref(item.friend_id)}
                          aria-label={"Message " + name}
                        >
                          <MessageSquare size={14} />
                          Message
                        </Link>
                        <button
                          type="button"
                          className="ui-button small ghost"
                          onClick={() =>
                            setRemove({ id: item.friend_id, name })
                          }
                          aria-label={"Remove " + name}
                        >
                          <UserMinus size={14} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
        <PeopleYouMayKnow showViewAll={false} />
      </div>
      <Modal
        open={!!remove}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
        title="Remove this connection?"
        description={
          remove
            ? remove.name + " will be removed from your friends."
            : undefined
        }
        footer={
          <>
            <button
              className="ui-button secondary"
              type="button"
              onClick={() => setRemove(null)}
            >
              Keep connection
            </button>
            <button
              className="ui-button"
              type="button"
              disabled={action.isPending}
              onClick={() =>
                remove && action.mutate({ kind: "remove", id: remove.id })
              }
            >
              {action.isPending ? "Removing…" : "Remove connection"}
            </button>
          </>
        }
      >
        {action.isError ? (
          <DataError error={action.error} />
        ) : (
          <p className="ui-subtle">
            You can send a new connection request later.
          </p>
        )}
      </Modal>
    </div>
  );
}
