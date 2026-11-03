"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
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
  sendMessage,
  startConversation,
  type Conversation,
  type Message,
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
type ConversationsPage = {
  conversations: Conversation[];
  total: number;
  page: number;
  has_more: boolean;
};
type MessagesPage = { messages: Message[]; total: number; has_more: boolean };
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
  // `recipient` is canonical (see messageRecipientHref); `to` (older
  // profile links) and `user` remain accepted aliases.
  const initialRecipient =
    params.get("recipient") ||
    params.get("to") ||
    params.get("user") ||
    undefined;
  const [composing, setComposing] = useState(!!initialRecipient);
  const { subscribe, isConnected } = useRealtime();
  const client = useQueryClient();
  const key = ["inbox", "conversations", user?.id];
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => getConversations(pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.page + 1 : undefined,
    refetchInterval: isConnected ? false : 15_000,
  });
  const conversations =
    query.data?.pages.flatMap((page) => page.conversations) ?? [];
  const inList = conversations.find(
    (conversation) => conversation.id === selectedId,
  );
  // Deep links may name a conversation beyond the loaded list pages.
  const single = useQuery({
    queryKey: ["inbox", "conversation", user?.id, selectedId],
    queryFn: () => getConversation(selectedId as string),
    enabled: !!selectedId && !inList,
  });
  const selected = inList ?? single.data;
  // On reconnect, catch up anything the socket missed while away.
  const wasConnected = useRef(isConnected);
  useEffect(() => {
    if (isConnected && !wasConnected.current) {
      void client.invalidateQueries({ queryKey: ["inbox"] });
    }
    wasConnected.current = isConnected;
  }, [client, isConnected]);
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
        client.setQueryData<InfiniteData<MessagesPage, string | undefined>>(
          ["inbox", "messages", user?.id, payload.conversation_id],
          (previous) => {
            if (!previous || previous.pages.length === 0) return previous;
            const already = previous.pages.some((page) =>
              page.messages.some((item) => item.id === message.id),
            );
            if (already) return previous;
            // pages[0] holds the newest chunk in display order.
            const pages = previous.pages.map((page, index) =>
              index === 0
                ? { ...page, messages: [...page.messages, message] }
                : page,
            );
            return { ...previous, pages };
          },
        );
        void client.invalidateQueries({
          queryKey: ["inbox", "conversations", user?.id],
        });
      }),
    [client, subscribe, user?.id],
  );
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
                      {conversation.last_message?.content || "No messages yet"}
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
            {query.hasNextPage && (
              <button
                type="button"
                className="ui-button secondary"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage
                  ? "Loading…"
                  : "Load more conversations"}
              </button>
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
          ) : selectedId && (query.isPending || single.isPending) ? (
            <Loading label="Loading conversation…" />
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
            client.setQueryData<Conversation>(
              ["inbox", "conversation", user?.id, conversation.id],
              conversation,
            );
            client.setQueryData<InfiniteData<ConversationsPage, number>>(
              key,
              (previous) => {
                if (!previous || previous.pages.length === 0) {
                  return previous;
                }
                const pages = previous.pages.map((page, index) => ({
                  ...page,
                  conversations:
                    index === 0
                      ? [
                          conversation,
                          ...page.conversations.filter(
                            (item) => item.id !== conversation.id,
                          ),
                        ]
                      : page.conversations.filter(
                          (item) => item.id !== conversation.id,
                        ),
                }));
                return { ...previous, pages };
              },
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
  const { isConnected } = useRealtime();
  const client = useQueryClient();
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const prependScrollRef = useRef<{ height: number; top: number } | null>(
    null,
  );
  const lastSeenMessageRef = useRef<string | undefined>(undefined);
  const lastMarkedRef = useRef<string | null>(null);
  const key = ["inbox", "messages", user?.id, conversation.id];
  // Pages run newest-chunk first; each page is display-ordered internally.
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => getMessages(conversation.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.messages[0]?.id : undefined,
    refetchInterval: isConnected ? false : 15_000,
  });
  const messages = useMemo(
    () =>
      query.data
        ? [...query.data.pages].reverse().flatMap((page) => page.messages)
        : [],
    [query.data],
  );
  const count = messages.length;
  const send = useMutation({
    retry: false,
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      sendMessage(id, content),
    onSuccess: (message) => {
      nearBottomRef.current = true;
      client.setQueryData<InfiniteData<MessagesPage, string | undefined>>(
        key,
        (previous) => {
          if (!previous || previous.pages.length === 0) {
            return {
              pages: [{ messages: [message], total: 1, has_more: false }],
              pageParams: [undefined],
            };
          }
          const pages = previous.pages.map((page, index) =>
            index === 0
              ? {
                  ...page,
                  messages: [
                    ...page.messages.filter((item) => item.id !== message.id),
                    message,
                  ],
                }
              : page,
          );
          return { ...previous, pages };
        },
      );
      setDraft("");
      void client.invalidateQueries({
        queryKey: ["inbox", "conversations", user?.id],
      });
    },
  });
  // Keep the reader's place when older history is prepended; follow new
  // arrivals only when already near the bottom.
  useEffect(() => {
    const el = listRef.current;
    if (prependScrollRef.current && el) {
      el.scrollTop =
        el.scrollHeight - prependScrollRef.current.height + prependScrollRef.current.top;
      prependScrollRef.current = null;
      return;
    }
    const lastId = messages[messages.length - 1]?.id;
    if (lastId && lastId !== lastSeenMessageRef.current) {
      lastSeenMessageRef.current = lastId;
      if (nearBottomRef.current) {
        end.current?.scrollIntoView({ block: "nearest" });
      }
    }
  }, [count, messages]);
  // Acknowledge the newest rendered message from the other participant;
  // anything arriving later stays unread until it is rendered too.
  const newestOtherUnreadId = [...messages]
    .reverse()
    .find((message) => message.sender_id !== user?.id && !message.read_at)?.id;
  useEffect(() => {
    if (!newestOtherUnreadId || lastMarkedRef.current === newestOtherUnreadId) {
      return;
    }
    lastMarkedRef.current = newestOtherUnreadId;
    markConversationRead(conversation.id, newestOtherUnreadId)
      .then(() =>
        client.invalidateQueries({
          queryKey: ["inbox", "conversations", user?.id],
        }),
      )
      .catch(() => {
        lastMarkedRef.current = null;
      });
  }, [client, conversation.id, newestOtherUnreadId, user?.id]);
  function loadOlder() {
    const el = listRef.current;
    if (el) {
      prependScrollRef.current = { height: el.scrollHeight, top: el.scrollTop };
    }
    void query.fetchNextPage();
  }
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
        ref={listRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          nearBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 160;
        }}
        className="inbox-message-list"
        role="log"
        aria-label={"Messages with " + name(conversation)}
        aria-live="polite"
      >
        {query.hasNextPage && (
          <button
            type="button"
            className="ui-button secondary"
            disabled={query.isFetchingNextPage}
            onClick={loadOlder}
          >
            {query.isFetchingNextPage
              ? "Loading older messages…"
              : "Load older messages"}
          </button>
        )}
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
          messages.map((message) => (
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
          ))
        )}
        <div ref={end} />
      </div>
      <form className="inbox-compose" onSubmit={submit}>
        {send.isError && (
          <DataError title="Your message was not sent" error={send.error} />
        )}
        <div>
          <label className="sr-only" htmlFor="message-draft">
            Write a message
          </label>
          <textarea
            id="message-draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            placeholder="Write a message…"
            disabled={send.isPending}
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
                  initialRecipient
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
