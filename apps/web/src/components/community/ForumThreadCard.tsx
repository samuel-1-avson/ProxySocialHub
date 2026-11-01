import Link from "next/link";
import { ArrowUp, Eye, LockKeyhole, MessageSquare, Pin } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { ForumThread } from "@/lib/forum-api";

export function forumDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? formatDistanceToNow(date, { addSuffix: true })
    : "Date unavailable";
}

export function ForumThreadCard({ thread }: { thread: ForumThread }) {
  return (
    <article className="forum-thread ui-surface">
      <div className="forum-thread-votes">
        <ArrowUp size={15} aria-hidden="true" />
        <strong>{(thread.upvotes ?? 0) - (thread.downvotes ?? 0)}</strong>
        <span>votes</span>
      </div>
      <div className="forum-thread-body">
        <div className="forum-thread-labels">
          {thread.category && <span>{thread.category.name}</span>}
          {thread.is_pinned && (
            <span>
              <Pin size={11} aria-hidden="true" />
              Pinned
            </span>
          )}
          {thread.is_locked && (
            <span>
              <LockKeyhole size={11} aria-hidden="true" />
              Locked
            </span>
          )}
        </div>
        <h3>
          <Link href={"/help/forum/thread/" + thread.id}>{thread.title}</Link>
        </h3>
        {thread.content && <p>{thread.content}</p>}
        <div className="forum-thread-meta">
          <span>
            <MessageSquare size={13} aria-hidden="true" />
            {thread.replies_count ?? 0} replies
          </span>
          <span>
            <Eye size={13} aria-hidden="true" />
            {thread.views_count ?? 0} views
          </span>
          {thread.author && (
            <Link href={"/profile/" + thread.author.username}>
              {thread.author.display_name || thread.author.username}
            </Link>
          )}
          <span>{forumDate(thread.created_at)}</span>
        </div>
      </div>
    </article>
  );
}
