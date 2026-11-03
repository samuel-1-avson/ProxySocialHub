"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageSquare, Plus } from "lucide-react";
import {
  getPopularThreads,
  getRecentThreads,
  getUnansweredThreads,
  type ForumThread,
} from "@/lib/forum-api";
import {
  DataError,
  EmptyState,
  Loading,
  PageHeading,
} from "@/components/workspace/Patterns";
import { ForumThreadCard } from "./ForumThreadCard";

const views = {
  recent: {
    title: "Recent discussions",
    description: "The latest conversations across the community.",
    load: getRecentThreads,
  },
  popular: {
    title: "Popular discussions",
    description: "Conversations receiving the most community votes.",
    load: getPopularThreads,
  },
  unanswered: {
    title: "Unanswered questions",
    description: "Share what you know and help a community member get started.",
    load: getUnansweredThreads,
  },
};

export function ForumThreadCollection({ view }: { view: keyof typeof views }) {
  const config = views[view];
  const query = useQuery({
    queryKey: ["forum", view],
    queryFn: () => config.load(20),
  });
  const [extraThreads, setExtraThreads] = useState<ForumThread[]>([]);
  const [nextPage, setNextPage] = useState(2);
  const threads = [...(query.data?.threads ?? [])];
  for (const thread of extraThreads) {
    if (!threads.some((item) => item.id === thread.id)) threads.push(thread);
  }
  const total = query.data?.total ?? threads.length;
  const loadMore = useMutation({
    retry: false,
    mutationFn: () => config.load(20, nextPage),
    onSuccess: (result) => {
      setExtraThreads((previous) => {
        const merged = [...previous];
        for (const thread of result.threads) {
          if (!merged.some((item) => item.id === thread.id)) merged.push(thread);
        }
        return merged;
      });
      setNextPage((current) => current + 1);
    },
  });
  return (
    <div className="ui-page forum-page">
      <PageHeading
        eyebrow="Community / Discussions"
        title={config.title}
        description={config.description}
        actions={
          <Link className="ui-button" href="/help/forum/new">
            <Plus size={16} aria-hidden="true" />
            New discussion
          </Link>
        }
      />
      {query.isPending ? (
        <Loading label="Loading discussions…" />
      ) : query.isError ? (
        <DataError
          title="Discussions could not be loaded"
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : threads.length === 0 ? (
        <EmptyState
          title="No discussions here yet"
          description="Start a conversation or explore another forum section."
          href="/help/forum/new"
          action="Start a discussion"
          icon={<MessageSquare size={28} />}
        />
      ) : (
        <>
          <div className="forum-thread-list">
            {threads.map((thread) => (
              <ForumThreadCard key={thread.id} thread={thread} />
            ))}
          </div>
          {loadMore.isError && (
            <DataError
              title="More discussions could not be loaded"
              error={loadMore.error}
              retry={() => loadMore.mutate()}
            />
          )}
          {threads.length < total && (
            <button
              type="button"
              className="ui-button secondary"
              disabled={loadMore.isPending}
              onClick={() => loadMore.mutate()}
            >
              {loadMore.isPending ? "Loading…" : "Load more discussions"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
