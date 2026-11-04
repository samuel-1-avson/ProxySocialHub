"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Flag } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  createPost,
  FORUM_POST_MAX,
  forumCharCount,
  forumPostLabel,
  getThread,
  getThreadPosts,
  markPostSolution,
  reportPost,
  reportThread,
  type ForumPost,
} from "@/lib/forum-api";
import { Modal } from "@/components/patterns/Modal";
import { DataError, EmptyState, Loading } from "@/components/workspace/Patterns";
import { ComposeButton } from "@/components/community/ForumFeed";
import { threadPath } from "@/components/community/ForumThreadCard";
import { PostActions } from "@/components/community/post-actions";
import {
  asSentence,
  fullTime,
  personHref,
  personName,
  PostAvatar,
  PostBadges,
  PostText,
  shortTime,
} from "@/components/community/post-ui";

type ReportTarget = { type: "thread" | "post"; id: string };

function ThreadContent({ id }: { id: string }) {
  const { user, isAuthenticated } = useAuth();
  const client = useQueryClient();
  const key = ["forum", "thread", id];
  const query = useQuery({ queryKey: key, queryFn: () => getThread(id) });
  const thread = query.data?.thread;
  const [extraPosts, setExtraPosts] = useState<ForumPost[]>([]);
  const [nextPage, setNextPage] = useState(2);
  const firstPagePosts = query.data?.posts ?? [];
  const posts = [...firstPagePosts];
  for (const post of extraPosts) {
    if (!posts.some((item) => item.id === post.id)) posts.push(post);
  }
  const totalPosts = query.data?.total_posts ?? posts.length;
  const solutionPost = query.data?.solution_post ?? null;
  const solutionLoaded =
    !solutionPost || posts.some((post) => post.id === solutionPost.id);
  const loadMore = useMutation({
    retry: false,
    mutationFn: () => getThreadPosts(thread!.id, { page: nextPage }),
    onSuccess: (result) => {
      setExtraPosts((previous) => {
        const merged = [...previous];
        for (const post of result.posts) {
          if (!merged.some((item) => item.id === post.id)) merged.push(post);
        }
        return merged;
      });
      setNextPage((current) => current + 1);
    },
  });
  const replyBox = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ForumPost | null>(null);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [reportSuccess, setReportSuccess] = useState(false);
  const draftCount = forumCharCount(draft);
  const draftLeft = FORUM_POST_MAX - draftCount;
  const reply = useMutation({
    retry: false,
    mutationFn: () =>
      createPost(id, { content: draft.trim(), parent_id: replyTo?.id }),
    onSuccess: () => {
      setDraft("");
      setReplyTo(null);
      setExtraPosts([]);
      setNextPage(2);
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: ["forum", "feed"] });
    },
  });
  const solution = useMutation({
    retry: false,
    mutationFn: (post: ForumPost) =>
      markPostSolution(post.id, !post.is_solution),
    onSuccess: (updated) => {
      setExtraPosts((previous) =>
        previous.map((post) =>
          post.id === updated.id
            ? updated
            : updated.is_solution
              ? { ...post, is_solution: false }
              : post,
        ),
      );
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: ["forum", "feed"] });
    },
  });
  const canMark =
    !!user &&
    !!thread &&
    (user.id === thread.author_id ||
      ["admin", "moderator", "superadmin"].includes(user.role));

  // Grow the reply box with its content.
  useEffect(() => {
    const box = replyBox.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = Math.min(box.scrollHeight, 360) + "px";
  }, [draft]);

  // "Reply" on a feed card links here with #reply.
  const loaded = !!thread;
  useEffect(() => {
    if (!loaded || typeof window === "undefined") return;
    if (window.location.hash === "#reply") replyBox.current?.focus();
  }, [loaded]);

  function replyToPost(post: ForumPost | null) {
    setReplyTo(post);
    replyBox.current?.focus();
    replyBox.current?.scrollIntoView({ block: "center" });
  }

  if (query.isPending) return <Loading label="Loading post…" />;
  if (query.isError || !thread)
    return (
      <div className="ui-page">
        <Link className="ui-link" href="/help/forum">
          ← Back to discussions
        </Link>
        <DataError
          title="This post is unavailable"
          error={query.error}
          retry={() => void query.refetch()}
        />
      </div>
    );

  const path = threadPath(thread);
  const authorName = personName(thread.author);
  const authorProfile = personHref(thread.author, thread.author_id);
  const title = thread.title?.trim();

  function renderPost(
    post: ForumPost,
    depth = 0,
    ancestors: string[] = [],
  ): React.ReactNode {
    if (ancestors.includes(post.id) || depth > 8) return null;
    const children = posts.filter((item) => item.parent_id === post.id);
    const name = personName(post.author);
    const profile = personHref(post.author, post.author_id);
    return (
      <div className="reply-group" key={post.id}>
        <article
          id={"post-" + post.id}
          className={"post-card" + (post.is_solution ? " is-solution" : "")}
        >
          {profile ? (
            <Link href={profile} tabIndex={-1} aria-hidden="true">
              <PostAvatar person={post.author} small={depth > 0} />
            </Link>
          ) : (
            <PostAvatar person={post.author} small={depth > 0} />
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
              {post.author?.username && name !== post.author.username && (
                <span className="post-handle username">@{post.author.username}</span>
              )}
              <span className="post-handle" aria-hidden="true">
                ·
              </span>
              <time
                className="post-time"
                dateTime={post.created_at}
                title={fullTime(post.created_at)}
              >
                {shortTime(post.created_at)}
              </time>
            </header>
            {post.is_solution && (
              <div className="post-badges">
                <span className="post-badge solved">
                  <CheckCircle2 size={11} aria-hidden="true" />
                  Accepted answer
                </span>
              </div>
            )}
            <PostText text={post.content} />
            <PostActions
              onReply={
                isAuthenticated && !thread!.is_locked
                  ? () => replyToPost(post)
                  : undefined
              }
              replyLabel={"Reply to " + name}
              like={{
                kind: "post",
                id: post.id,
                liked: post.viewer_vote === 1,
                count: post.upvotes ?? 0,
                label: "reply by " + name,
              }}
              sharePath={path + "#post-" + post.id}
              shareLabel={"reply by " + name}
            >
              {canMark && (
                <button
                  type="button"
                  className="post-action more"
                  disabled={solution.isPending}
                  aria-pressed={post.is_solution}
                  onClick={() => solution.mutate(post)}
                >
                  <CheckCircle2 size={17} aria-hidden="true" />
                  {post.is_solution ? "Answer" : "Mark answer"}
                  <span className="sr-only"> for the reply by {name}</span>
                </button>
              )}
              {isAuthenticated && (
                <button
                  type="button"
                  className="post-action more"
                  aria-label={"Report reply by " + name}
                  onClick={() => setReport({ type: "post", id: post.id })}
                >
                  <Flag size={16} aria-hidden="true" />
                </button>
              )}
            </PostActions>
          </div>
        </article>
        {children.length > 0 && (
          <div className={depth < 3 ? "reply-branch" : ""}>
            {children.map((child) =>
              renderPost(child, depth + 1, [...ancestors, post.id]),
            )}
          </div>
        )}
      </div>
    );
  }

  const ids = new Set(posts.map((post) => post.id));
  const roots = posts.filter(
    (post) => !post.parent_id || !ids.has(post.parent_id),
  );

  return (
    <div className="ui-page feed-page forum-discussion">
      <div className="feed-layout">
        <div className="feed-column">
          <div className="conversation-top">
            <Link href="/help/forum" aria-label="Back to discussions">
              <ArrowLeft size={18} aria-hidden="true" />
            </Link>
            <h1>Post</h1>
          </div>
          <article className="post-detail" aria-label={"Post by " + authorName}>
            <div className="post-detail-author">
              {authorProfile ? (
                <Link href={authorProfile} tabIndex={-1} aria-hidden="true">
                  <PostAvatar person={thread.author} />
                </Link>
              ) : (
                <PostAvatar person={thread.author} />
              )}
              <div>
                {authorProfile ? (
                  <Link href={authorProfile}>{authorName}</Link>
                ) : (
                  <strong>{authorName}</strong>
                )}
                {thread.author?.username && (
                  <span>@{thread.author.username}</span>
                )}
              </div>
            </div>
            <PostBadges thread={thread} />
            {title && <h2 className="post-card-title">{title}</h2>}
            <PostText text={thread.content} fold={false} />
            <div className="post-detail-meta">
              <time dateTime={thread.created_at}>{fullTime(thread.created_at)}</time>
              <span aria-hidden="true">·</span>
              <span>
                <strong>{thread.views_count ?? 0}</strong>{" "}
                {(thread.views_count ?? 0) === 1 ? "view" : "views"}
              </span>
            </div>
            <PostActions
              replies={totalPosts}
              onReply={
                isAuthenticated && !thread.is_locked
                  ? () => replyToPost(null)
                  : undefined
              }
              like={{
                kind: "thread",
                id: thread.id,
                liked: thread.viewer_vote === 1,
                count: thread.upvotes ?? 0,
                label: "post by " + authorName,
              }}
              sharePath={path}
              shareLabel={"post by " + authorName}
            >
              {isAuthenticated && (
                <button
                  type="button"
                  className="post-action more"
                  aria-label="Report post"
                  onClick={() => setReport({ type: "thread", id: thread.id })}
                >
                  <Flag size={16} aria-hidden="true" />
                </button>
              )}
            </PostActions>
          </article>
          {thread.is_locked ? (
            <p className="feed-note">
              This post is locked. Existing replies stay available to read.
            </p>
          ) : isAuthenticated ? (
            <form
              id="reply"
              className="post-composer"
              aria-label="Reply to this post"
              onSubmit={(event) => {
                event.preventDefault();
                if (draft.trim() && draftLeft >= 0 && !reply.isPending) reply.mutate();
              }}
            >
              <PostAvatar person={user} />
              <div className="post-composer-body">
                <p className="reply-replying-to">
                  Replying to{" "}
                  <span>
                    @
                    {replyTo
                      ? replyTo.author?.username || "member"
                      : thread.author?.username || "author"}
                  </span>
                  {replyTo && (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="ui-link"
                        onClick={() => setReplyTo(null)}
                      >
                        Reply to the post instead
                      </button>
                    </>
                  )}
                </p>
                <textarea
                  ref={replyBox}
                  id="thread-reply"
                  aria-label="Your reply"
                  rows={1}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    if (reply.isError) reply.reset();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      if (draft.trim() && draftLeft >= 0 && !reply.isPending) reply.mutate();
                    }
                  }}
                  placeholder="Post your reply"
                />
                {reply.isError && (
                  <p className="post-error" role="alert">
                    {asSentence(
                      reply.error instanceof Error
                        ? reply.error.message
                        : "Your reply was not posted",
                    )}{" "}
                    Your text is still here.
                  </p>
                )}
                <div className="post-composer-toolbar">
                  <span className="post-composer-spacer" />
                  {draftCount > 0 && (
                    <span
                      className={
                        "post-counter" +
                        (draftLeft < 0 ? " over" : draftLeft <= 50 ? " near" : "")
                      }
                      aria-live="polite"
                    >
                      {draftLeft <= 50
                        ? draftLeft
                        : draftCount + " / " + FORUM_POST_MAX}
                    </span>
                  )}
                  <button
                    className="ui-button post-submit"
                    type="submit"
                    disabled={!draft.trim() || draftLeft < 0 || reply.isPending}
                  >
                    {reply.isPending ? "Replying…" : "Reply"}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <div className="post-signin">
              <span>Sign in to reply, like, or report.</span>
              <Link
                className="ui-button small"
                href={"/login?next=" + encodeURIComponent(path)}
              >
                Sign in
              </Link>
            </div>
          )}
          {solution.isError && (
            <div className="feed-state">
              <DataError
                title="The answer was not updated"
                error={solution.error}
              />
            </div>
          )}
          {reportSuccess && (
            <p className="feed-note" role="status">
              Thanks. Your report was sent to the moderators.
            </p>
          )}
          {solutionPost && !solutionLoaded && (
            <section aria-label="Accepted solution">
              <h2 className="conversation-section-label">Accepted answer</h2>
              {renderPost(solutionPost)}
            </section>
          )}
          <section aria-label="Replies">
            <h2 className="conversation-section-label">
              {totalPosts} {totalPosts === 1 ? "reply" : "replies"}
            </h2>
            {posts.length === 0 ? (
              <div className="feed-state">
                <EmptyState
                  title="No replies yet"
                  description="Be the first to reply."
                />
              </div>
            ) : (
              <div className="post-list">
                {(roots.length ? roots : posts).map((post) => renderPost(post))}
              </div>
            )}
            {loadMore.isError && (
              <div className="feed-state">
                <DataError
                  title="More replies could not be loaded"
                  error={loadMore.error}
                  retry={() => loadMore.mutate()}
                />
              </div>
            )}
            {posts.length < totalPosts && (
              <div className="feed-more">
                <button
                  type="button"
                  className="ui-button secondary"
                  disabled={loadMore.isPending}
                  onClick={() => loadMore.mutate()}
                >
                  {loadMore.isPending
                    ? "Loading more replies…"
                    : "Load more replies (" + (totalPosts - posts.length) + " more)"}
                </button>
              </div>
            )}
          </section>
        </div>
        <aside className="feed-rail conversation-rail" aria-label="Discussion tools">
          <ComposeButton />
          <section className="feed-rail-card guidelines" aria-labelledby="thread-guidelines">
            <h2 id="thread-guidelines">Keep it friendly</h2>
            <p>
              Be kind, share what helps, and keep passwords, tokens, and wallet
              secrets to yourself.
            </p>
            <Link className="ui-link" href="/guidelines">
              Community guidelines →
            </Link>
          </section>
        </aside>
      </div>
      <Modal
        open={!!report}
        onOpenChange={(open) => {
          if (!open) setReport(null);
        }}
        title="Report content"
        description="Choose the reason so the moderation team can review this content."
      >
        {report && (
          <ReportForm
            key={report.id}
            target={report}
            label={report.type === "thread" ? forumPostLabel(thread, 60) : undefined}
            onSuccess={() => {
              setReport(null);
              setReportSuccess(true);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function ReportForm({
  target,
  label,
  onSuccess,
}: {
  target: ReportTarget;
  label?: string;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const submit = useMutation({
    retry: false,
    mutationFn: () =>
      target.type === "thread"
        ? reportThread(target.id, reason, details)
        : reportPost(target.id, reason, details),
    onSuccess,
  });
  return (
    <form
      className="ui-page"
      onSubmit={(event) => {
        event.preventDefault();
        if (reason && !submit.isPending) submit.mutate();
      }}
    >
      {label && <p className="ui-subtle">Reporting: {label}</p>}
      <label className="ui-field">
        Report reason
        <select
          className="ui-select"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
        >
          <option value="">Choose a reason</option>
          {[
            ["spam", "Spam or misleading"],
            ["harassment", "Harassment or bullying"],
            ["inappropriate", "Inappropriate content"],
            ["offtopic", "Off-topic"],
            ["other", "Other"],
          ].map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      </label>
      <label className="ui-field">
        Additional details
        <textarea
          className="ui-input"
          rows={4}
          value={details}
          onChange={(event) => setDetails(event.target.value)}
        />
      </label>
      {submit.isError && (
        <DataError title="Your report was not submitted" error={submit.error} />
      )}
      <button
        className="ui-button"
        type="submit"
        disabled={!reason || submit.isPending}
      >
        {submit.isPending ? "Submitting…" : "Submit report"}
      </button>
    </form>
  );
}

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  return <ThreadContent key={id} id={id} />;
}
