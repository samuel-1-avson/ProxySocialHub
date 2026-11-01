"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Plus,
} from "lucide-react";
import { getCategory, getCategoryThreads } from "@/lib/forum-api";
import {
  DataError,
  EmptyState,
  Loading,
  PageHeading,
} from "@/components/workspace/Patterns";
import { ForumThreadCard } from "@/components/community/ForumThreadCard";

const PAGE_SIZE = 20;
function CategoryContent({ slug }: { slug: string }) {
  const [page, setPage] = useState(1);
  const category = useQuery({
    queryKey: ["forum", "category", slug],
    queryFn: () => getCategory(slug),
  });
  const threads = useQuery({
    queryKey: ["forum", "category-threads", slug, page],
    queryFn: () => getCategoryThreads(slug, { page, limit: PAGE_SIZE }),
  });
  const totalPages = Math.max(
    1,
    Math.ceil((threads.data?.total ?? 0) / PAGE_SIZE),
  );
  return (
    <div className="ui-page forum-page">
      <Link className="ui-button ghost self-start" href="/help/forum">
        <ArrowLeft size={15} aria-hidden="true" />
        All forum topics
      </Link>
      <PageHeading
        eyebrow="Community / Topic"
        title={category.data?.category.name || "Forum topic"}
        description={
          category.data?.category.description ||
          "Conversations from this community topic."
        }
        actions={
          category.data && !category.data.category.is_locked ? (
            <Link href="/help/forum/new" className="ui-button">
              <Plus size={16} aria-hidden="true" />
              New discussion
            </Link>
          ) : undefined
        }
      />
      {category.isPending && <Loading label="Loading topic…" />}
      {category.isError && (
        <DataError
          title="This topic could not be loaded"
          error={category.error}
          retry={() => void category.refetch()}
        />
      )}
      {category.data?.category.is_locked && (
        <p className="workflow-note">
          This category is read-only. You can browse existing conversations.
        </p>
      )}
      {threads.isPending ? (
        <Loading label="Loading discussions…" />
      ) : threads.isError ? (
        <DataError
          title="Discussions could not be loaded"
          error={threads.error}
          retry={() => void threads.refetch()}
        />
      ) : !threads.data.threads?.length ? (
        <EmptyState
          title="No discussions in this topic"
          description="Return to the forum to explore another topic."
          href="/help/forum"
          action="Browse topics"
          icon={<MessageSquare size={28} />}
        />
      ) : (
        <div className="forum-thread-list">
          {threads.data.threads.map((thread) => (
            <ForumThreadCard key={thread.id} thread={thread} />
          ))}
        </div>
      )}
      {totalPages > 1 && (
        <nav className="ui-actions" aria-label="Discussion pages">
          <button
            className="ui-button secondary"
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            <ChevronLeft size={15} aria-hidden="true" />
            Previous
          </button>
          <span className="ui-subtle" role="status">
            Page {page} of {totalPages}
          </span>
          <button
            className="ui-button secondary"
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </nav>
      )}
    </div>
  );
}
export default function ForumCategoryPage() {
  const { slug } = useParams<{ slug: string }>();
  return <CategoryContent key={slug} slug={slug} />;
}
