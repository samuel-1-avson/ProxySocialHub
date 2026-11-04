"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Eye, Heart, Link2, MessageCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  votePost,
  voteThread,
  type ForumPost,
  type ForumThread,
} from "@/lib/forum-api";
import { compactCount } from "./post-ui";

type ThreadPatch = Partial<Pick<ForumThread, "upvotes" | "downvotes" | "viewer_vote">>;

/**
 * Update one post everywhere it is cached (feeds, search, the conversation
 * view), so a like shows the same on every screen without refetching.
 */
export function patchThreadInCache(
  client: QueryClient,
  threadId: string,
  patch: ThreadPatch,
) {
  const fix = (thread: ForumThread) =>
    thread.id === threadId ? { ...thread, ...patch } : thread;
  client.setQueriesData({ queryKey: ["forum"] }, (data: unknown) => {
    if (!data || typeof data !== "object") return data;
    const value = data as Record<string, unknown>;
    if (Array.isArray(value.pages)) {
      return {
        ...value,
        pages: value.pages.map((page) =>
          page && Array.isArray((page as { threads?: unknown }).threads)
            ? {
                ...(page as object),
                threads: (page as { threads: ForumThread[] }).threads.map(fix),
              }
            : page,
        ),
      };
    }
    if (Array.isArray(value.threads)) {
      return { ...value, threads: (value.threads as ForumThread[]).map(fix) };
    }
    if (value.thread && (value.thread as ForumThread).id === threadId) {
      return { ...value, thread: fix(value.thread as ForumThread) };
    }
    return data;
  });
}

/** Same for a reply inside a conversation view. */
export function patchPostInCache(
  client: QueryClient,
  postId: string,
  patch: Partial<Pick<ForumPost, "upvotes" | "downvotes" | "viewer_vote">>,
) {
  const fix = (post: ForumPost) => (post.id === postId ? { ...post, ...patch } : post);
  client.setQueriesData({ queryKey: ["forum", "thread"] }, (data: unknown) => {
    if (!data || typeof data !== "object") return data;
    const value = data as { posts?: ForumPost[]; solution_post?: ForumPost | null };
    return {
      ...value,
      posts: value.posts?.map(fix),
      solution_post: value.solution_post ? fix(value.solution_post) : value.solution_post,
    };
  });
}

/** The heart: likes or unlikes a post (thread) or a reply (post). */
export function LikeButton({
  kind,
  id,
  liked: likedFromServer,
  count: countFromServer,
  label,
  onChange,
}: {
  kind: "thread" | "post";
  id: string;
  liked: boolean;
  count: number;
  /** Who wrote it, for the screen-reader label. */
  label: string;
  onChange?: (result: { liked: boolean; count: number }) => void;
}) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname() || "/help/forum";
  const client = useQueryClient();
  // The optimistic value shown while a like is saving. It is tied to the
  // server values it started from, so fresh server data replaces it.
  const serverKey = likedFromServer + ":" + countFromServer;
  const [local, setLocal] = useState<{ liked: boolean; count: number; base: string } | null>(null);
  const shown = local && local.base === serverKey ? local : { liked: likedFromServer, count: countFromServer };
  const { liked, count } = shown;
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    if (!isAuthenticated) {
      router.push("/login?next=" + encodeURIComponent(pathname));
      return;
    }
    if (pending) return;
    const next = { liked: !liked, count: Math.max(0, count + (liked ? -1 : 1)) };
    setLocal({ ...next, base: serverKey });
    setPending(true);
    setFailed(false);
    try {
      const result =
        kind === "thread" ? await voteThread(id, "up") : await votePost(id, "up");
      const confirmed = {
        liked: result.viewer_vote === undefined ? next.liked : result.viewer_vote === 1,
        count: result.upvotes ?? next.count,
      };
      setLocal({ ...confirmed, base: serverKey });
      const patch = {
        upvotes: confirmed.count,
        downvotes: result.downvotes,
        viewer_vote: confirmed.liked ? 1 : 0,
      };
      if (kind === "thread") patchThreadInCache(client, id, patch);
      else patchPostInCache(client, id, patch);
      onChange?.(confirmed);
    } catch {
      setLocal(null);
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={"post-action like" + (liked ? " liked" : "")}
        aria-pressed={liked}
        onClick={(event) => {
          event.stopPropagation();
          void toggle();
        }}
      >
        <Heart size={17} fill={liked ? "currentColor" : "none"} aria-hidden="true" />
        {/* The name is built from text so it always contains the visible count. */}
        <span className="sr-only">
          {"Like " + label}
          {count > 0 ? ", " : ""}
        </span>
        {count > 0 && <span>{compactCount(count)}</span>}
        {count > 0 && <span className="sr-only">{count === 1 ? " like" : " likes"}</span>}
      </button>
      {failed && (
        <span className="post-error" role="alert">
          Your like was not saved.
        </span>
      )}
    </>
  );
}

/** Copies a link to the post. */
export function ShareButton({ path, label }: { path: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);
  async function share() {
    const url = window.location.origin + path;
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
  }
  return (
    <>
      <button
        type="button"
        className="post-action share"
        aria-label={"Copy link to " + label}
        onClick={(event) => {
          event.stopPropagation();
          void share();
        }}
      >
        <Link2 size={17} aria-hidden="true" />
      </button>
      <span role="status" className={state === "failed" ? "post-error" : "post-flash"}>
        {state === "copied" ? "Link copied" : state === "failed" ? "Copy failed" : ""}
      </span>
    </>
  );
}

/** The action row under a post: reply, like, share, views. */
export function PostActions({
  replies,
  replyHref,
  onReply,
  replyLabel: replyLabelOverride,
  like,
  sharePath,
  shareLabel,
  views,
  children,
}: {
  replies?: number;
  replyHref?: string;
  onReply?: () => void;
  /** Screen-reader name of the reply control, for example "Reply to Alex". */
  replyLabel?: string;
  like: React.ComponentProps<typeof LikeButton>;
  sharePath?: string;
  shareLabel?: string;
  views?: number;
  children?: ReactNode;
}) {
  // Names come from text (screen-reader-only words around the visible count),
  // so the accessible name always contains what is shown.
  const replyContent = (
    <>
      <MessageCircle size={17} aria-hidden="true" />
      <span className="sr-only">
        {replyLabelOverride ?? "Reply"}
        {replies ? ", " : ""}
      </span>
      {!!replies && <span>{compactCount(replies)}</span>}
      {!!replies && <span className="sr-only">{replies === 1 ? " reply" : " replies"}</span>}
    </>
  );
  return (
    <div className="post-actions">
      {replyHref ? (
        <Link
          className="post-action reply"
          href={replyHref}
          onClick={(event) => event.stopPropagation()}
        >
          {replyContent}
        </Link>
      ) : onReply ? (
        <button
          type="button"
          className="post-action reply"
          onClick={(event) => {
            event.stopPropagation();
            onReply();
          }}
        >
          {replyContent}
        </button>
      ) : (
        <span className="post-action reply">{replyContent}</span>
      )}
      <LikeButton {...like} />
      {views !== undefined && (
        <span className="post-action views">
          <Eye size={17} aria-hidden="true" />
          <span aria-hidden="true">{compactCount(views)}</span>
          <span className="sr-only">{views + (views === 1 ? " view" : " views")}</span>
        </span>
      )}
      {sharePath && <ShareButton path={sharePath} label={shareLabel || "this post"} />}
      {children}
    </div>
  );
}
