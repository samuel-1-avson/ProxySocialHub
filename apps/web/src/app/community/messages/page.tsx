"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpRight,
  Inbox,
  Plus,
  Search,
  Send,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  getConversation,
  getConversations,
  getMessages,
  markConversationRead,
  mergeMessages,
  sendMessage,
  startConversation,
  type Conversation,
  type Message,
  type MessageThread,
} from "@/lib/social-api";
import { getPublicProfile } from "@/lib/api/profile";
import { getFriends } from "@/lib/friends-api";
import { useRealtime, WS_MESSAGE_TYPES } from "@/lib/websocket";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Modal } from "@/components/patterns/Modal";
import {
  PageHeading,
  Loading,
  DataError,
  EmptyState,
} from "@/components/workspace/Patterns";

function displayDate(value: string | undefined, time = false) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? time
      ? date.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })
      : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "";
}
function name(conversation: Conversation) {
  return (
    conversation.other_participant?.display_name ||
    conversation.other_participant?.username ||
    "Community member"
  );
}
function MessagesContent() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("conversation");
  const [search, setSearch] = useState("");
  const initialRecipient =
    params.get("recipient") || params.get("user") || undefined;
  const [composing, setComposing] = useState(!!initialRecipient);
  const { subscribe, isConnected } = useRealtime();
  const client = useQueryClient();
  const key = ["inbox", "conversations", user?.id];
  const query = useQuery({
    queryKey: key,
    queryFn: getConversations,
    refetchInterval: isConnected ? false : 15_000,
  });
  const conversations = query.data?.conversations ?? [];
  const inList = conversations.find(
    (conversation) => conversation.id === selectedId,
  );
  // A link from a notification can point at a conversation further down the
  // list than the first page; look for it before calling it unavailable.
  const missing = Boolean(selectedId) && query.isSuccess && !inList;
  const farther = useQuery({
    queryKey: ["inbox", "conversation", user?.id, selectedId],
    queryFn: () => getConversation(selectedId!),
    enabled: missing,
  });
  const selected = inList ?? farther.data;
  const filtered = conversations.filter((conversation) =>
    (name(conversation) + " " + (conversation.last_message?.content || ""))
      .toLowerCase()
      .includes(search.toLowerCase().trim()),
  );
  function select(id: string | null) {
    router.replace(
      id ? "/messages?conversation=" + encodeURIComponent(id) : "/messages",
      { scroll: false },
    );
  }
  useEffect(
    () =>
      subscribe(WS_MESSAGE_TYPES.NEW_MESSAGE, (event) => {
        const payload = event.data as
          | { conversation_id?: string; message?: Message }
          | undefined;
        if (!payload?.conversation_id || !payload.message?.id) return;
        const message = payload.message;
        client.setQueryData<MessageThread>(
          ["inbox", "messages", user?.id, payload.conversation_id],
          (previous) =>
            previous
              ? {
                  ...previous,
                  messages: mergeMessages(previous.messages, [message]),
                }
              : previous,
        );
        void client.invalidateQueries({
          queryKey: ["inbox", "conversations", user?.id],
        });
      }),
    [client, subscribe, user?.id],
  );
  useEffect(() => {
    const replaceMessage = (
      conversationId: string,
      update: (message: Message) => Message,
      messageId: string,
    ) => {
      client.setQueryData<{ messages: Message[] }>(
        ["inbox", "messages", user?.id, conversationId],
        (previous) =>
          previous
            ? {
                messages: previous.messages.map((item) =>
                  item.id === messageId ? update(item) : item,
                ),
              }
            : previous,
      );
      void client.invalidateQueries({
        queryKey: ["inbox", "conversations", user?.id],
      });
    };
    const offUpdated = subscribe(WS_MESSAGE_TYPES.MESSAGE_UPDATED, (event) => {
      const payload = event.data as
        | { conversation_id?: string; message?: Message }
        | undefined;
      if (!payload?.conversation_id || !payload.message?.id) return;
      const updated = payload.message;
      replaceMessage(payload.conversation_id, () => updated, updated.id);
    });
    const offDeleted = subscribe(WS_MESSAGE_TYPES.MESSAGE_DELETED, (event) => {
      const payload = event.data as
        | { conversation_id?: string; message_id?: string }
        | undefined;
      if (!payload?.conversation_id || !payload.message_id) return;
      replaceMessage(
        payload.conversation_id,
        (item) => ({ ...item, content: "", is_deleted: true }),
        payload.message_id,
      );
    });
    return () => {
      offUpdated();
      offDeleted();
    };
  }, [client, subscribe, user?.id]);
  return (
    <div className="ui-page inbox-page">
      <PageHeading
        eyebrow="Community / Private conversations"
        title="Inbox"
        description="Keep conversations with providers and community members in one place."
        actions={
          <button
            type="button"
            className="ui-button"
            onClick={() => setComposing(true)}
          >
            <Plus size={16} />
            New message
          </button>
        }
      />
      <div
        className={
          "inbox-layout ui-surface " + (selectedId ? "has-conversation" : "")
        }
      >
        <aside className="inbox-list" aria-label="Conversations">
          <label className="inbox-search">
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">Search conversations</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search conversations…"
            />
          </label>
          <p className="inbox-connection" role="status">
            <span className={isConnected ? "connected" : ""} />
            {isConnected
              ? "Live updates connected"
              : "Checking for new messages periodically"}
          </p>
          <div className="inbox-conversations">
            {query.isPending ? (
              <Loading label="Loading conversations…" />
            ) : query.isError ? (
              <DataError
                title="Conversations are unavailable"
                error={query.error}
                retry={() => void query.refetch()}
              />
            ) : filtered.length === 0 ? (
              <div className="inbox-list-empty">
                <Inbox size={25} aria-hidden="true" />
                <strong>
                  {search ? "No matching conversations" : "Your inbox is ready"}
                </strong>
                <p>
                  {search
                    ? "Try another name or phrase."
                    : "Start a message or contact a provider from a listing."}
                </p>
              </div>
            ) : (
              filtered.map((conversation) => (
                <button
                  type="button"
                  key={conversation.id}
                  className={
                    "inbox-conversation " +
                    (selectedId === conversation.id ? "active" : "")
                  }
                  aria-current={
                    selectedId === conversation.id ? "true" : undefined
                  }
                  onClick={() => select(conversation.id)}
                >
                  <span className="inbox-avatar">
                    {name(conversation).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="inbox-conversation-copy">
                    <strong>{name(conversation)}</strong>
                    <span>
                      {conversation.last_message?.is_deleted
                        ? "This message was deleted."
                        : conversation.last_message?.content ||
                          "No messages yet"}
                    </span>
                  </span>
                  <span className="inbox-conversation-meta">
                    <time>{displayDate(conversation.last_message_at)}</time>
                    {(conversation.unread_count ?? 0) > 0 && (
                      <span
                        className="inbox-unread"
                        aria-label={
                          conversation.unread_count + " unread messages"
                        }
                      >
                        {conversation.unread_count}
                      </span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>
        <section className="inbox-thread">
          {selected ? (
            <ConversationThread
              key={selected.id}
              conversation={selected}
              onBack={() => select(null)}
            />
          ) : selectedId && query.isSuccess && farther.isFetching ? (
            <Loading label="Finding this conversation…" />
          ) : selectedId && query.isSuccess ? (
            <EmptyState
              title="This conversation is unavailable"
              description="Return to your inbox to choose an available conversation."
            />
          ) : (
            <div className="inbox-welcome">
              <span>
                <Inbox size={32} aria-hidden="true" />
              </span>
              <h2>A clear line of communication.</h2>
              <p>
                Select a conversation to read your messages, or start a new one.
              </p>
              <button
                type="button"
                className="ui-button secondary"
                onClick={() => setComposing(true)}
              >
                <Plus size={15} />
                Start a message
              </button>
            </div>
          )}
        </section>
      </div>
      <Modal
        open={composing}
        onOpenChange={(open) => {
          setComposing(open);
          if (!open && initialRecipient) select(selectedId);
        }}
        title="New message"
        description="Choose a connection and write the first message."
      >
        <NewConversation
          initialRecipient={initialRecipient}
          onStarted={(conversation) => {
            client.setQueryData<{ conversations: Conversation[] }>(
              key,
              (previous) => ({
                conversations: [
                  conversation,
                  ...(previous?.conversations ?? []).filter(
                    (item) => item.id !== conversation.id,
                  ),
                ],
              }),
            );
            setComposing(false);
            select(conversation.id);
          }}
        />
      </Modal>
    </div>
  );
}
function ConversationThread({
  conversation,
  onBack,
}: {
  conversation: Conversation;
  onBack: () => void;
}) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const key = ["inbox", "messages", user?.id, conversation.id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => getMessages(conversation.id),
    // A dropped socket can miss messages; look again when the tab returns.
    refetchOnWindowFocus: true,
  });
  const messages = query.data?.messages ?? [];
  const send = useMutation({
    retry: false,
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      sendMessage(id, content),
    onSuccess: (message) => {
      client.setQueryData<MessageThread>(key, (previous) => ({
        page: previous?.page ?? 1,
        hasMore: previous?.hasMore ?? false,
        messages: mergeMessages(previous?.messages ?? [], [message]),
      }));
      setDraft("");
      // The box stays enabled while sending, so typing can continue; put the
      // cursor back for the next message.
      field.current?.focus();
      void client.invalidateQueries({
        queryKey: ["inbox", "conversations", user?.id],
      });
    },
  });
  // Older messages: the thread opens on the newest page.
  const older = useMutation({
    retry: false,
    mutationFn: () => getMessages(conversation.id, (query.data?.page ?? 1) + 1),
    onSuccess: (result) => {
      client.setQueryData<MessageThread>(key, (previous) => ({
        page: result.page,
        hasMore: result.hasMore,
        messages: mergeMessages(result.messages, previous?.messages ?? []),
      }));
    },
  });
  const count = messages.length;
  // Follow the newest message. Loading older ones above must not move the view.
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lastId]);
  // Reading a conversation clears its unread count, now and as new messages
  // arrive while it is open.
  const markedFor = useRef<string | null>(null);
  const lastIncomingId = [...messages]
    .reverse()
    .find((message) => message.sender_id !== user?.id && !message.is_deleted)?.id;
  useEffect(() => {
    if (!query.isSuccess || !lastIncomingId) return;
    if (markedFor.current === lastIncomingId) return;
    const firstLook = markedFor.current === null;
    markedFor.current = lastIncomingId;
    if (firstLook && !((conversation.unread_count ?? 0) > 0)) return;
    markConversationRead(conversation.id)
      .then(() =>
        client.invalidateQueries({
          queryKey: ["inbox", "conversations", user?.id],
        }),
      )
      .catch(() => {});
  }, [
    query.isSuccess,
    lastIncomingId,
    conversation.id,
    conversation.unread_count,
    client,
    user?.id,
  ]);
  function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (!draft.trim() || send.isPending) return;
    send.mutate({ id: conversation.id, content: draft.trim() });
  }
  const profile =
    conversation.other_participant?.username ||
    conversation.other_participant?.id;
  return (
    <>
      <header className="inbox-thread-header">
        <button
          className="inbox-back credential-icon-button"
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="inbox-avatar">
          {name(conversation).slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h2>{name(conversation)}</h2>
          {profile && (
            <Link
              className="ui-link"
              href={"/profile/" + encodeURIComponent(profile)}
            >
              View profile <ArrowUpRight size={12} />
            </Link>
          )}
        </div>
      </header>
      <div
        className="inbox-message-list"
        role="log"
        aria-label={"Messages with " + name(conversation)}
        aria-relevant="additions"
      >
        {query.isPending ? (
          <Loading label="Loading messages…" />
        ) : query.isError ? (
          <DataError
            title="Messages could not be loaded"
            error={query.error}
            retry={() => void query.refetch()}
          />
        ) : count === 0 ? (
          <p className="inbox-empty-thread">
            No messages yet. Write the first message below.
          </p>
        ) : (
          <>
            {query.data?.hasMore && (
              <div className="inbox-older">
                <button
                  type="button"
                  className="ui-button secondary small"
                  disabled={older.isPending}
                  onClick={() => older.mutate()}
                >
                  {older.isPending ? "Loading…" : "Load earlier messages"}
                </button>
                {older.isError && (
                  <p className="ui-note" role="alert">
                    Earlier messages could not be loaded. Try again.
                  </p>
                )}
              </div>
            )}
            {messages.map((message) => (
            <article
              key={message.id}
              className={
                "inbox-message " +
                (message.sender_id === user?.id ? "sent" : "received")
              }
            >
              <p>
                {message.is_deleted
                  ? "This message was deleted."
                  : message.content}
              </p>
              <time dateTime={message.created_at}>
                {message.sender_id === user?.id ? "You · " : ""}
                {displayDate(message.created_at, true)}
                {message.edited_at ? " · Edited" : ""}
              </time>
            </article>
            ))}
          </>
        )}
        <div ref={end} />
      </div>
      <form className="inbox-compose" onSubmit={submit}>
        {send.isError && (
          <DataError
            title="Your message was not sent"
            error={send.error}
            retry={draft.trim() ? () => submit() : undefined}
          />
        )}
        <div>
          <label className="sr-only" htmlFor="message-draft">
            Write a message
          </label>
          <textarea
            id="message-draft"
            ref={field}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Write a message…"
            readOnly={send.isPending}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button
            type="submit"
            className="ui-button"
            disabled={!draft.trim() || send.isPending}
            aria-label={"Send message to " + name(conversation)}
          >
            <Send size={17} />
            {send.isPending ? "Sending…" : "Send"}
          </button>
        </div>
        <p>Enter to send · Shift + Enter for a new line</p>
      </form>
    </>
  );
}
function NewConversation({
  onStarted,
  initialRecipient,
}: {
  onStarted: (conversation: Conversation) => void;
  initialRecipient?: string;
}) {
  const { user } = useAuth();
  const friends = useQuery({
    queryKey: ["inbox", "friends", user?.id],
    queryFn: getFriends,
    enabled: !initialRecipient,
  });
  const [recipient, setRecipient] = useState(initialRecipient || "");
  const recipientProfile = useQuery({
    queryKey: ["inbox", "recipient", initialRecipient],
    queryFn: () => getPublicProfile(initialRecipient!),
    enabled: !!initialRecipient,
  });
  const [content, setContent] = useState("");
  const start = useMutation({
    retry: false,
    mutationFn: () => startConversation(recipient, content.trim()),
    onSuccess: onStarted,
  });
  return (
    <form
      className="ui-page"
      onSubmit={(event) => {
        event.preventDefault();
        if (recipient && content.trim() && !start.isPending) start.mutate();
      }}
    >
      {!initialRecipient && friends.isPending && (
        <Loading label="Loading connections…" />
      )}
      {!initialRecipient && friends.isError && (
        <DataError
          title="Connections could not be loaded"
          error={friends.error}
          retry={() => void friends.refetch()}
        />
      )}
      {!initialRecipient &&
      friends.isSuccess &&
      !friends.data.friends.length ? (
        <EmptyState
          title="Connect with someone first"
          description="You can contact a provider from a marketplace listing or add a community connection."
          href="/marketplace"
          action="Browse marketplace"
        />
      ) : (
        <>
          {initialRecipient ? (
            <label className="ui-field">
              Recipient
              <input
                className="ui-input"
                value={
                  recipientProfile.data?.display_name ||
                  recipientProfile.data?.username ||
                  (recipientProfile.isPending ? "Loading…" : "Unverified member")
                }
                readOnly
              />
              {recipientProfile.isError && (
                <span className="ui-note">
                  This recipient could not be verified. Try again from their
                  profile.
                </span>
              )}
            </label>
          ) : (
            <label className="ui-field">
              Recipient
              <select
                className="ui-select"
                required
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
              >
                <option value="">Choose a connection</option>
                {friends.data?.friends.map((friend) => (
                  <option key={friend.id} value={friend.friend_id}>
                    {friend.friend?.display_name ||
                      friend.friend?.username ||
                      friend.friend_id}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="ui-field">
            First message
            <textarea
              className="ui-input"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={5}
              required
              placeholder="Introduce yourself or explain how they can help."
            />
          </label>
          {start.isError && (
            <DataError
              title="Conversation could not be started"
              error={start.error}
            />
          )}
          <button
            type="submit"
            className="ui-button"
            disabled={
              !recipient ||
              !content.trim() ||
              start.isPending ||
              (!!initialRecipient && !recipientProfile.isSuccess)
            }
          >
            <Send size={15} />
            {start.isPending ? "Starting…" : "Start conversation"}
          </button>
        </>
      )}
    </form>
  );
}
export default function MessagesPage() {
  return (
    <ProtectedRoute>
      <MessagesContent />
    </ProtectedRoute>
  );
}
