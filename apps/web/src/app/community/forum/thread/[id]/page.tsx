"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Flag,
  MessageSquare,
  Share2,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  getThread,
  getThreadPosts,
  createPost,
  votePost,
  voteThread,
  reportPost,
  reportThread,
  markPostSolution,
  type ForumPost,
} from "@/lib/forum-api";
import { Modal } from "@/components/patterns/Modal";
import { CopyValue } from "@/components/workspace/CopyValue";
import {
  DataError,
  EmptyState,
  Loading,
  PageHeading,
  Status,
} from "@/components/workspace/Patterns";
import { forumDate } from "@/components/community/ForumThreadCard";

type VoteChoice = "up" | "down";
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
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ForumPost | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [reportSuccess, setReportSuccess] = useState(false);
  const vote = useMutation({
    retry: false,
    mutationFn: ({
      postId,
      choice,
    }: {
      postId?: string;
      choice: VoteChoice;
    }) => (postId ? votePost(postId, choice) : voteThread(id, choice)),
    onSuccess: (result, variables) =>
      client.setQueryData<Awaited<ReturnType<typeof getThread>>>(
        key,
        (previous) =>
          !previous
            ? previous
            : variables.postId
              ? {
                  ...previous,
                  posts: previous.posts.map((post) =>
                    post.id === variables.postId
                      ? { ...post, ...result }
                      : post,
                  ),
                }
              : { ...previous, thread: { ...previous.thread, ...result } },
      ),
  });
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
      void client.invalidateQueries({ queryKey: ["forum", "recent"] });
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
    },
  });
  const canMark =
    !!user &&
    !!thread &&
    (user.id === thread.author_id ||
      ["admin", "moderator", "superadmin"].includes(user.role));
  function replyToPost(post: ForumPost | null) {
    setReplyTo(post);
    document.getElementById("thread-reply")?.focus();
    document
      .getElementById("thread-reply")
      ?.scrollIntoView({ block: "center" });
  }
  if (query.isPending) return <Loading label="Loading discussion…" />;
  if (query.isError || !thread)
    return (
      <div className="ui-page">
        <Link className="ui-link" href="/help/forum">
          ← Back to forum
        </Link>
        <DataError
          title="This discussion is unavailable"
          error={query.error}
          retry={() => void query.refetch()}
        />
      </div>
    );
  function votes(post?: ForumPost) {
    const item = post ?? thread!;
    return (
      <div className="thread-votes">
        <button
          type="button"
          aria-label={
            post
              ? "Upvote reply by " + (post.author?.username || "member")
              : "Upvote discussion"
          }
          disabled={!isAuthenticated || vote.isPending}
          onClick={() => vote.mutate({ postId: post?.id, choice: "up" })}
        >
          <ArrowUp size={18} />
        </button>
        <span>{(item.upvotes ?? 0) - (item.downvotes ?? 0)}</span>
        <button
          type="button"
          aria-label={
            post
              ? "Downvote reply by " + (post.author?.username || "member")
              : "Downvote discussion"
          }
          disabled={!isAuthenticated || vote.isPending}
          onClick={() => vote.mutate({ postId: post?.id, choice: "down" })}
        >
          <ArrowDown size={18} />
        </button>
      </div>
    );
  }
  function renderPost(
    post: ForumPost,
    depth = 0,
    ancestors: string[] = [],
  ): React.ReactNode {
    if (ancestors.includes(post.id) || depth > 8) return null;
    const children = posts.filter((item) => item.parent_id === post.id);
    return (
      <div className="thread-reply-group" key={post.id}>
        <article
          id={"post-" + post.id}
          className={
            "thread-post ui-surface " + (post.is_solution ? "solution" : "")
          }
        >
          <header>
            <div>
              <Link
                href={"/profile/" + (post.author?.username || post.author_id)}
              >
                {post.author?.display_name ||
                  post.author?.username ||
                  "Community member"}
              </Link>
              <span>{forumDate(post.created_at)}</span>
            </div>
            {post.is_solution && (
              <Status tone="good">
                <CheckCircle2 size={12} />
                Accepted solution
              </Status>
            )}
          </header>
          <p>{post.content}</p>
          <footer>
            {votes(post)}
            <div className="thread-post-actions">
              {isAuthenticated && !thread!.is_locked && (
                <button
                  className="ui-link"
                  type="button"
                  onClick={() => replyToPost(post)}
                >
                  <MessageSquare size={14} />
                  Reply
                </button>
              )}
              {canMark && (
                <button
                  className="ui-link"
                  type="button"
                  disabled={solution.isPending}
                  onClick={() => solution.mutate(post)}
                >
                  {post.is_solution ? "Unmark solution" : "Accept solution"}
                </button>
              )}
              {isAuthenticated && (
                <button
                  className="ui-link"
                  type="button"
                  onClick={() => setReport({ type: "post", id: post.id })}
                >
                  <Flag size={13} />
                  Report reply
                </button>
              )}
            </div>
          </footer>
        </article>
        {children.length > 0 && (
          <div className={depth < 3 ? "thread-nested" : ""}>
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
  const shareUrl =
    typeof window !== "undefined"
      ? window.location.origin + "/help/forum/thread/" + id
      : "/help/forum/thread/" + id;
  return (
    <div className="ui-page forum-discussion">
      <Link href="/help/forum" className="ui-button ghost self-start">
        <ArrowLeft size={15} />
        Back to forum
      </Link>
      <PageHeading
        eyebrow={"Community / " + (thread.category?.name || "Discussion")}
        title={thread.title}
        description={
          "Started by " +
          (thread.author?.display_name ||
            thread.author?.username ||
            "a community member") +
          " · " +
          forumDate(thread.created_at)
        }
        actions={
          <button
            type="button"
            className="ui-button secondary"
            onClick={() => setShareOpen(true)}
          >
            <Share2 size={15} />
            Share discussion
          </button>
        }
      />
      <article className="thread-document ui-surface">
        <div className="thread-document-tools">
          {votes()}
          <div className="ui-actions">
            {thread.is_pinned && <Status>Pinned</Status>}
            {thread.is_locked && <Status tone="warning">Locked</Status>}
            <span className="ui-subtle">
              {thread.views_count ?? 0} views · {totalPosts} replies
            </span>
          </div>
        </div>
        <div className="thread-document-content">{thread.content}</div>
        <footer>
          {isAuthenticated && !thread.is_locked && (
            <button
              className="ui-button secondary"
              type="button"
              onClick={() => replyToPost(null)}
            >
              <MessageSquare size={15} />
              Reply to discussion
            </button>
          )}
          {isAuthenticated && (
            <button
              className="ui-link"
              type="button"
              onClick={() => setReport({ type: "thread", id: thread.id })}
            >
              <Flag size={14} />
              Report discussion
            </button>
          )}
        </footer>
      </article>
      {vote.isError && (
        <DataError title="Your vote was not recorded" error={vote.error} />
      )}
      {solution.isError && (
        <DataError
          title="The solution was not updated"
          error={solution.error}
        />
      )}
      {reportSuccess && (
        <p className="workflow-note" role="status">
          Your report has been submitted for review.
        </p>
      )}
      {solutionPost && !solutionLoaded && (
        <section aria-label="Accepted solution">
          <div className="ui-section-heading">
            <h2>Accepted solution</h2>
          </div>
          {renderPost(solutionPost)}
        </section>
      )}
      <section aria-label="Discussion replies">
        <div className="ui-section-heading">
          <h2>
            {totalPosts} {totalPosts === 1 ? "reply" : "replies"}
          </h2>
        </div>
        {posts.length === 0 ? (
          <EmptyState
            title="Be the first to reply"
            description="Share an answer, ask for context, or add your experience."
          />
        ) : (
          <div className="thread-replies">
            {(roots.length ? roots : posts).map((post) => renderPost(post))}
          </div>
        )}
        {loadMore.isError && (
          <DataError
            title="More replies could not be loaded"
            error={loadMore.error}
            retry={() => loadMore.mutate()}
          />
        )}
        {posts.length < totalPosts && (
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
        )}
      </section>
      {thread.is_locked ? (
        <p className="workflow-note">
          This discussion is locked. Existing replies remain available to read.
        </p>
      ) : isAuthenticated ? (
        <form
          className="ui-surface thread-reply-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim() && !reply.isPending) reply.mutate();
          }}
        >
          <h2>
            {replyTo
              ? "Reply to " + (replyTo.author?.username || "member")
              : "Add your reply"}
          </h2>
          {replyTo && (
            <div className="workflow-note">
              <p>{replyTo.content.slice(0, 160)}</p>
              <button
                type="button"
                className="ui-link"
                onClick={() => setReplyTo(null)}
              >
                Reply to discussion instead
              </button>
            </div>
          )}
          <label className="ui-field" htmlFor="thread-reply">
            Your reply
            <textarea
              id="thread-reply"
              aria-label="Your reply"
              className="ui-input"
              rows={6}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              required
              placeholder="Add useful context or share your answer."
            />
          </label>
          {reply.isError && (
            <DataError title="Your reply was not posted" error={reply.error} />
          )}
          <button
            className="ui-button"
            type="submit"
            disabled={!draft.trim() || reply.isPending}
          >
            {reply.isPending ? "Posting…" : "Post reply"}
          </button>
        </form>
      ) : (
        <EmptyState
          title="Join the conversation"
          description="Sign in to reply, vote, or report content."
          href={"/login?next=" + encodeURIComponent("/help/forum/thread/" + id)}
          action="Sign in"
        />
      )}
      <Modal
        open={shareOpen}
        onOpenChange={setShareOpen}
        title="Share this discussion"
        description="Copy the public discussion link."
      >
        <CopyValue label="discussion link" value={shareUrl} />
      </Modal>
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
  onSuccess,
}: {
  target: ReportTarget;
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
          ].map(([value, label]) => (
            <option key={value} value={value}>
              {label}
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
