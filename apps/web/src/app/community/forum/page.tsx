"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, MessageSquare, Plus, Search, X } from "lucide-react";
import {
  getForumCategories,
  getRecentThreads,
  searchForum,
  type ForumThread,
} from "@/lib/forum-api";
import {
  DataError,
  EmptyState,
  Loading,
  PageHeading,
} from "@/components/workspace/Patterns";
import { ForumThreadCard } from "@/components/community/ForumThreadCard";

export default function ForumPage() {
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const categories = useQuery({
    queryKey: ["forum", "categories"],
    queryFn: getForumCategories,
  });
  const recent = useQuery({
    queryKey: ["forum", "recent"],
    queryFn: () => getRecentThreads(20),
  });
  const results = useQuery({
    queryKey: ["forum", "search", search],
    queryFn: () => searchForum(search),
    enabled: !!search,
  });
  const [extraResults, setExtraResults] = useState<ForumThread[]>([]);
  const [nextSearchPage, setNextSearchPage] = useState(2);
  const loadMoreResults = useMutation({
    retry: false,
    mutationFn: () => searchForum(search, nextSearchPage),
    onSuccess: (result) => {
      setExtraResults((previous) => {
        const merged = [...previous];
        for (const thread of result.threads) {
          if (!merged.some((item) => item.id === thread.id)) merged.push(thread);
        }
        return merged;
      });
      setNextSearchPage((current) => current + 1);
    },
  });
  const threads = search ? results : recent;
  const displayThreads = [...(threads.data?.threads ?? [])];
  if (search) {
    for (const thread of extraResults) {
      if (!displayThreads.some((item) => item.id === thread.id)) {
        displayThreads.push(thread);
      }
    }
  }
  const searchTotal = results.data?.total ?? 0;
  function resetSearchPages() {
    setExtraResults([]);
    setNextSearchPage(2);
  }
  return (
    <div className="ui-page forum-page">
      <PageHeading
        eyebrow="Community / Shared knowledge"
        title="Community forum"
        description="Get help, share practical advice, and discuss the network with buyers and providers."
        actions={
          <Link href="/help/forum/new" className="ui-button">
            <Plus size={16} aria-hidden="true" />
            New discussion
          </Link>
        }
      />
      <form
        className="forum-search"
        onSubmit={(event) => {
          event.preventDefault();
          resetSearchPages();
          setSearch(draft.trim());
        }}
        role="search"
      >
        <Search size={19} aria-hidden="true" />
        <label className="sr-only" htmlFor="forum-search">
          Search discussions
        </label>
        <input
          id="forum-search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Search questions, guides, and conversations…"
        />
        {(draft || search) && (
          <button
            type="button"
            aria-label="Clear forum search"
            onClick={() => {
              setDraft("");
              resetSearchPages();
              setSearch("");
            }}
          >
            <X size={17} />
          </button>
        )}
        <button type="submit" className="ui-button small">
          Search
        </button>
      </form>
      <div className="forum-layout">
        <div>
          {!search && (
            <section aria-labelledby="forum-categories">
              <div className="ui-section-heading">
                <h2 id="forum-categories">Find your topic</h2>
              </div>
              {categories.isPending ? (
                <Loading label="Loading topics…" />
              ) : categories.isError ? (
                <DataError
                  title="Forum topics are unavailable"
                  error={categories.error}
                  retry={() => void categories.refetch()}
                />
              ) : !categories.data.categories?.length ? (
                <p className="workflow-note">
                  No forum categories have been published yet.
                </p>
              ) : (
                <div className="forum-categories">
                  {categories.data.categories.map((category) => (
                    <Link
                      key={category.id}
                      className="forum-category ui-surface"
                      href={"/help/forum/category/" + category.slug}
                    >
                      <MessageSquare size={20} aria-hidden="true" />
                      <h3>{category.name}</h3>
                      <p>{category.description}</p>
                      <span>
                        {category.thread_count ?? 0} discussions
                        <ArrowRight size={14} aria-hidden="true" />
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}
          <section
            className="forum-discussions"
            aria-labelledby="forum-discussions"
          >
            <div className="ui-section-heading">
              <div>
                {search && <p className="ui-eyebrow">Results for “{search}”</p>}
                <h2 id="forum-discussions">
                  {search ? "Search results" : "Latest conversations"}
                </h2>
              </div>
              {!search && (
                <Link href="/help/forum?sort=recent" className="ui-link">
                  View all →
                </Link>
              )}
            </div>
            {threads.isPending ? (
              <Loading
                label={
                  search ? "Searching discussions…" : "Loading discussions…"
                }
              />
            ) : threads.isError ? (
              <DataError
                title={
                  search
                    ? "Search could not be completed"
                    : "Discussions are unavailable"
                }
                error={threads.error}
                retry={() => void threads.refetch()}
              />
            ) : !displayThreads.length ? (
              <EmptyState
                title={
                  search ? "No matching discussions" : "Start the conversation"
                }
                description={
                  search
                    ? "Try another word or browse the forum topics."
                    : "Ask a question or share something useful with the community."
                }
                href={search ? undefined : "/help/forum/new"}
                action="New discussion"
                icon={<MessageSquare size={28} />}
              />
            ) : (
              <>
                <div className="forum-thread-list">
                  {displayThreads.map((thread) => (
                    <ForumThreadCard key={thread.id} thread={thread} />
                  ))}
                </div>
                {loadMoreResults.isError && (
                  <DataError
                    title="More results could not be loaded"
                    error={loadMoreResults.error}
                    retry={() => loadMoreResults.mutate()}
                  />
                )}
                {search && displayThreads.length < searchTotal && (
                  <button
                    type="button"
                    className="ui-button secondary"
                    disabled={loadMoreResults.isPending}
                    onClick={() => loadMoreResults.mutate()}
                  >
                    {loadMoreResults.isPending
                      ? "Loading…"
                      : "Load more results"}
                  </button>
                )}
              </>
            )}
          </section>
        </div>
        <aside className="forum-guidance ui-surface">
          <p className="ui-eyebrow">Make yourself at home</p>
          <h2>
            Better questions.
            <br />
            Useful answers.
          </h2>
          <p>
            Include your goal, what you tried, and the details that will help
            others understand the issue.
          </p>
          <ul>
            <li>Keep conversations respectful.</li>
            <li>Share advice that others can use.</li>
            <li>Keep credentials and wallet secrets private.</li>
          </ul>
          <Link className="ui-link" href="/guidelines">
            Community guidelines <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </aside>
      </div>
    </div>
  );
}
