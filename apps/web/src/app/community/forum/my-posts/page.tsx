"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, MessageSquare } from "lucide-react";
import { getMyPosts } from "@/lib/forum-api";
import { useAuth } from "@/lib/auth";
import {
  DataError,
  EmptyState,
  Loading,
  PageHeading,
  Status,
} from "@/components/workspace/Patterns";
import { forumDate } from "@/components/community/ForumThreadCard";

export default function MyPostsPage() {
  const { user, isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: ["forum", "my-posts", user?.id],
    queryFn: () => getMyPosts({ page: 1, limit: 20 }),
    enabled: isAuthenticated,
  });
  return (
    <div className="ui-page forum-page">
      <PageHeading
        eyebrow="Community / Your activity"
        title="My posts"
        description="Your recent replies and contributions to community discussions."
      />
      {!isAuthenticated ? (
        <EmptyState
          title="Sign in to see your posts"
          description="Your contributions are linked to your ProxyHubb account."
          href="/login?next=%2Fhelp%2Fforum%3Ffilter%3Dmine"
          action="Sign in"
        />
      ) : query.isPending ? (
        <Loading label="Loading your posts…" />
      ) : query.isError ? (
        <DataError
          title="Your posts could not be loaded"
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : !query.data.posts?.length ? (
        <EmptyState
          title="Your first conversation is waiting"
          description="Explore the forum and share your experience with the community."
          href="/help/forum"
          action="Browse discussions"
          icon={<MessageSquare size={28} />}
        />
      ) : (
        <div className="forum-thread-list">
          {query.data.posts.map((post) => (
            <article key={post.id} className="ui-surface forum-post-preview">
              <div className="ui-actions">
                <span className="ui-subtle">{forumDate(post.created_at)}</span>
                {post.is_solution && (
                  <Status tone="good">Accepted solution</Status>
                )}
                <span className="ui-subtle">
                  {post.upvotes - post.downvotes} votes
                </span>
              </div>
              <p>{post.content}</p>
              <Link
                className="ui-link"
                href={"/help/forum/thread/" + post.thread_id}
              >
                View discussion
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
