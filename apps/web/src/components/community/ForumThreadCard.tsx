"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { forumPostLabel, type ForumThread } from "@/lib/forum-api";
import {
  fullTime,
  personHref,
  personName,
  PostAvatar,
  PostBadges,
  PostText,
  shortTime,
} from "./post-ui";
import { PostActions } from "./post-actions";

export function forumDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? formatDistanceToNow(date, { addSuffix: true })
    : "Date unavailable";
}

export function threadPath(thread: Pick<ForumThread, "id">) {
  return "/help/forum/thread/" + encodeURIComponent(thread.id);
}

/** One post in a timeline. Clicking anywhere that is not a control opens it. */
export function ForumThreadCard({ thread }: { thread: ForumThread }) {
  const router = useRouter();
  const href = threadPath(thread);
  const profile = personHref(thread.author, thread.author_id);
  const name = personName(thread.author);
  const label = forumPostLabel(thread, 60);
  const title = thread.title?.trim();
  return (
    <article
      className="post-card clickable"
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("a, button, input, textarea")) return;
        if (window.getSelection()?.toString()) return;
        router.push(href);
      }}
    >
      {profile ? (
        <Link href={profile} tabIndex={-1} aria-hidden="true" onClick={(event) => event.stopPropagation()}>
          <PostAvatar person={thread.author} />
        </Link>
      ) : (
        <PostAvatar person={thread.author} />
      )}
      <div className="post-card-body">
        <header className="post-card-head">
          {profile ? (
            <Link className="post-name" href={profile}>
              {name}
            </Link>
          ) : (
            <span className="post-name">{name}</span>
          )}
          {thread.author?.username && name !== thread.author.username && (
            <span className="post-handle username">@{thread.author.username}</span>
          )}
          <span className="post-handle" aria-hidden="true">
            ·
          </span>
          <Link className="post-time" href={href} title={fullTime(thread.created_at)}>
            <time dateTime={thread.created_at}>{shortTime(thread.created_at)}</time>
            <span className="sr-only">, open post: {label}</span>
          </Link>
        </header>
        <PostBadges thread={thread} />
        {title && (
          <h2 className="post-card-title">
            <Link href={href}>{title}</Link>
          </h2>
        )}
        {thread.content && <PostText text={thread.content} />}
        <PostActions
          replies={thread.replies_count ?? 0}
          replyHref={thread.is_locked ? href : href + "#reply"}
          like={{
            kind: "thread",
            id: thread.id,
            liked: thread.viewer_vote === 1,
            count: thread.upvotes ?? 0,
            label: "post by " + name,
          }}
          views={thread.views_count ?? 0}
          sharePath={href}
          shareLabel={"post by " + name}
        />
      </div>
    </article>
  );
}
