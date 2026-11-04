"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useInfiniteQuery,
  useQuery,
  type QueryFunctionContext,
} from "@tanstack/react-query";
import {
  Clock,
  Flame,
  HelpCircle,
  PenLine,
  Search,
  UserRoundCheck,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ROUTES } from "@/lib/navigation/routes";
import {
  getCategory,
  getCategoryThreads,
  getFollowingThreads,
  getForumCategories,
  getMyPosts,
  getMyThreadPage,
  getPopularThreads,
  getQuestionThreads,
  getRecentThreads,
  getUnansweredThreads,
  FORUM_QUESTION_TOPIC,
  searchForum,
  type ThreadListPage,
} from "@/lib/forum-api";
import { Modal } from "@/components/patterns/Modal";
import { DataError, EmptyState, Loading } from "@/components/workspace/Patterns";
import { ForumThreadCard, threadPath } from "./ForumThreadCard";
import { PostComposer } from "./PostComposer";
import { PostText, shortTime } from "./post-ui";

export type FeedView =
  | "latest"
  | "popular"
  | "following"
  | "questions"
  | "unanswered"
  | "mine"
  | "topic";

const PAGE_SIZE = 20;

const TABS: { view: FeedView; label: string; href: string; icon: typeof Clock }[] = [
  { view: "latest", label: "Latest", href: ROUTES.communityForum, icon: Clock },
  { view: "popular", label: "Popular", href: ROUTES.communityForumPopular, icon: Flame },
  { view: "following", label: "Following", href: "/help/forum?filter=following", icon: UserRoundCheck },
  { view: "questions", label: "Questions", href: "/help/forum?filter=questions", icon: HelpCircle },
  { view: "mine", label: "Your posts", href: ROUTES.communityForumMyPosts, icon: PenLine },
];

const EMPTY: Record<FeedView, { title: string; description: string }> = {
  latest: {
    title: "Say hi to the network",
    description: "Nothing has been posted yet. Share a tip, a win, or a question.",
  },
  popular: {
    title: "No popular posts yet",
    description: "Posts people like show up here.",
  },
  following: {
    title: "Posts from people you follow show up here",
    description: "Follow buyers and providers from People or their profiles.",
  },
  questions: {
    title: "No questions yet",
    description: "Use the question button in the post box to ask the community.",
  },
  unanswered: {
    title: "Every post has a reply",
    description: "Nice work, community. Check back later.",
  },
  mine: {
    title: "You haven't posted yet",
    description: "Your posts show up here once you share something.",
  },
  topic: {
    title: "Nothing in this topic yet",
    description: "Be the first to post here.",
  },
};

function loaderFor(view: FeedView, slug?: string) {
  switch (view) {
    case "popular":
      return (page: number) => getPopularThreads(PAGE_SIZE, page);
    case "following":
      return (page: number) => getFollowingThreads(PAGE_SIZE, page);
    case "questions":
      return (page: number) => getQuestionThreads(PAGE_SIZE, page);
    case "unanswered":
      return (page: number) => getUnansweredThreads(PAGE_SIZE, page);
    case "mine":
      return (page: number) => getMyThreadPage(PAGE_SIZE, page);
    case "topic":
      return async (page: number): Promise<ThreadListPage> => {
        const data = await getCategoryThreads(slug || "", { page, limit: PAGE_SIZE });
        return {
          threads: data.threads ?? [],
          total: data.total ?? 0,
          page: data.page ?? page,
          limit: data.limit ?? PAGE_SIZE,
          has_more:
            data.has_more ??
            (data.page ?? page) * (data.limit ?? PAGE_SIZE) < (data.total ?? 0),
        };
      };
    default:
      return (page: number) => getRecentThreads(PAGE_SIZE, page);
  }
}

/** The "Post" button: opens the post box in a dialog from anywhere. */
export function ComposeButton({ defaultTopic }: { defaultTopic?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ui-button post-submit" onClick={() => setOpen(true)}>
        <PenLine size={16} aria-hidden="true" />
        Post
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Create a post"
        description="Share a thought, a tip, or a question with the community."
      >
        <PostComposer
          standalone
          autoFocus
          defaultTopic={defaultTopic}
          onPosted={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

function FeedList({ view, slug }: { view: FeedView; slug?: string }) {
  const { isAuthenticated } = useAuth();
  const needsSession = view === "following" || view === "mine";
  const load = loaderFor(view, slug);
  const feed = useInfiniteQuery({
    queryKey: ["forum", "feed", view, slug ?? ""],
    queryFn: ({ pageParam }: QueryFunctionContext<readonly unknown[], number>) =>
      load(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last: ThreadListPage) => (last.has_more ? last.page + 1 : undefined),
    enabled: !needsSession || isAuthenticated,
  });

  if (needsSession && !isAuthenticated) {
    return (
      <div className="feed-state">
        <EmptyState
          title={view === "following" ? "Sign in to see who you follow" : "Sign in to see your posts"}
          description="Your feed is linked to your ProxyHubb account."
          href={"/login?next=" + encodeURIComponent(view === "following" ? "/help/forum?filter=following" : "/help/forum?filter=mine")}
          action="Sign in"
        />
      </div>
    );
  }
  if (feed.isPending) {
    return (
      <div className="feed-state">
        <Loading label="Loading posts…" />
      </div>
    );
  }
  // A failed "Show more" keeps the posts already shown (handled below).
  if (feed.isError && !feed.data) {
    return (
      <div className="feed-state">
        <DataError
          title="Posts could not be loaded"
          error={feed.error}
          retry={() => void feed.refetch()}
        />
      </div>
    );
  }
  const seen = new Set<string>();
  const threads = (feed.data?.pages ?? [])
    .flatMap((page) => page.threads)
    .filter((thread) => (seen.has(thread.id) ? false : (seen.add(thread.id), true)));
  if (threads.length === 0) {
    const empty = EMPTY[view];
    return (
      <div className="feed-state">
        <EmptyState
          title={empty.title}
          description={empty.description}
          href={view === "following" ? ROUTES.communityFriends : undefined}
          action={view === "following" ? "Find people" : undefined}
        />
      </div>
    );
  }
  return (
    <>
      <div className="post-list">
        {threads.map((thread) => (
          <ForumThreadCard key={thread.id} thread={thread} />
        ))}
      </div>
      {feed.isFetchNextPageError && (
        <div className="feed-state">
          <DataError
            title="More posts could not be loaded"
            error={feed.error}
            retry={() => void feed.fetchNextPage()}
          />
        </div>
      )}
      {feed.hasNextPage && (
        <div className="feed-more">
          <button
            type="button"
            className="ui-button secondary"
            disabled={feed.isFetchingNextPage}
            onClick={() => void feed.fetchNextPage()}
          >
            {feed.isFetchingNextPage ? "Loading…" : "Show more posts"}
          </button>
        </div>
      )}
    </>
  );
}

function SearchResults({ query }: { query: string }) {
  const results = useInfiniteQuery({
    queryKey: ["forum", "search", query],
    queryFn: ({ pageParam }: QueryFunctionContext<readonly unknown[], number>) =>
      searchForum(query, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last: ThreadListPage) => (last.has_more ? last.page + 1 : undefined),
  });
  if (results.isPending) {
    return (
      <div className="feed-state">
        <Loading label="Searching posts…" />
      </div>
    );
  }
  if (results.isError && !results.data) {
    return (
      <div className="feed-state">
        <DataError
          title="Search could not be completed"
          error={results.error}
          retry={() => void results.refetch()}
        />
      </div>
    );
  }
  const seen = new Set<string>();
  const threads = (results.data?.pages ?? [])
    .flatMap((page) => page.threads)
    .filter((thread) => (seen.has(thread.id) ? false : (seen.add(thread.id), true)));
  if (!threads.length) {
    return (
      <div className="feed-state">
        <EmptyState
          title="No matching posts"
          description="Try another word, or start the conversation yourself."
        />
      </div>
    );
  }
  return (
    <>
      <div className="post-list">
        {threads.map((thread) => (
          <ForumThreadCard key={thread.id} thread={thread} />
        ))}
      </div>
      {results.hasNextPage && (
        <div className="feed-more">
          <button
            type="button"
            className="ui-button secondary"
            disabled={results.isFetchingNextPage}
            onClick={() => void results.fetchNextPage()}
          >
            {results.isFetchingNextPage ? "Loading…" : "Load more results"}
          </button>
        </div>
      )}
    </>
  );
}

function MyReplies() {
  const { user } = useAuth();
  const replies = useQuery({
    queryKey: ["forum", "my-posts", user?.id],
    queryFn: () => getMyPosts({ page: 1, limit: 10 }),
  });
  if (!replies.data?.posts?.length) return null;
  return (
    <section aria-labelledby="my-replies">
      <h2 id="my-replies" className="conversation-section-label">
        Your recent replies
      </h2>
      <div className="post-list">
        {replies.data.posts.map((post) => (
          <article key={post.id} className="post-card">
            <div className="post-card-body">
              <div className="post-card-head">
                <span className="post-handle">Replied</span>
                <span className="post-handle" aria-hidden="true">
                  ·
                </span>
                <time className="post-handle" dateTime={post.created_at}>
                  {shortTime(post.created_at)}
                </time>
                {post.is_solution && <span className="post-badge solved">Accepted answer</span>}
              </div>
              <PostText text={post.content} />
              <Link className="ui-link" href={threadPath({ id: post.thread_id }) + "#post-" + post.id}>
                View conversation →
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Rail({
  search,
  onSearch,
  activeTopic,
}: {
  search: string;
  onSearch: (value: string) => void;
  activeTopic?: string;
}) {
  const [draft, setDraft] = useState(search);
  const [tooShort, setTooShort] = useState(false);
  const categories = useQuery({
    queryKey: ["forum", "categories"],
    queryFn: getForumCategories,
  });
  return (
    <aside className="feed-rail" aria-label="Search and topics">
      <form
        role="search"
        className="feed-search"
        onSubmit={(event) => {
          event.preventDefault();
          const value = draft.trim();
          if (value && Array.from(value).length < 3) {
            setTooShort(true);
            return;
          }
          setTooShort(false);
          onSearch(value);
        }}
      >
        <Search size={17} aria-hidden="true" />
        <label className="sr-only" htmlFor="forum-search">
          Search posts
        </label>
        <input
          id="forum-search"
          type="search"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setTooShort(false);
          }}
          placeholder="Search posts"
          enterKeyHint="search"
        />
        {(draft || search) && (
          <button
            type="button"
            aria-label="Clear forum search"
            onClick={() => {
              setDraft("");
              setTooShort(false);
              onSearch("");
            }}
          >
            <X size={16} />
          </button>
        )}
      </form>
      {tooShort && (
        <p className="post-error" role="alert">
          Type at least 3 characters to search.
        </p>
      )}
      <section className="feed-rail-card topics" aria-labelledby="forum-topics">
        <h2 id="forum-topics">Topics</h2>
        {categories.isError ? (
          <p>Topics are unavailable right now.</p>
        ) : (
          <nav className="feed-topics" aria-label="Topics">
            {(categories.data?.categories ?? []).map((category) => (
              <Link
                key={category.id}
                href={"/help/forum/category/" + encodeURIComponent(category.slug)}
                aria-current={activeTopic === category.slug ? "page" : undefined}
              >
                <span>#{category.name}</span>
                <span>{category.thread_count ?? 0}</span>
              </Link>
            ))}
          </nav>
        )}
      </section>
      <section className="feed-rail-card guidelines" aria-labelledby="forum-guidelines">
        <h2 id="forum-guidelines">Keep it friendly</h2>
        <p>
          Be kind, share what helps, and keep passwords, tokens, and wallet
          secrets to yourself.
        </p>
        <Link className="ui-link" href="/guidelines">
          Community guidelines →
        </Link>
      </section>
    </aside>
  );
}

function TopicBanner({ slug }: { slug: string }) {
  const category = useQuery({
    queryKey: ["forum", "category", slug],
    queryFn: () => getCategory(slug),
  });
  if (category.isError) {
    return (
      <div className="feed-state">
        <DataError
          title="This topic could not be loaded"
          error={category.error}
          retry={() => void category.refetch()}
        />
      </div>
    );
  }
  const data = category.data?.category;
  return (
    <div className="feed-topic-banner">
      <div>
        <h2>#{data?.name || slug}</h2>
        {data?.description && <p>{data.description}</p>}
      </div>
    </div>
  );
}

/**
 * Discussions as a timeline: tabs, the post box, and posts. Search replaces
 * the posts with results until it is cleared.
 */
export function ForumFeed({ view, slug }: { view: FeedView; slug?: string }) {
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const topicQuery = useQuery({
    queryKey: ["forum", "category", slug ?? ""],
    queryFn: () => getCategory(slug || ""),
    enabled: view === "topic" && !!slug,
  });
  const topicLocked = view === "topic" && !!topicQuery.data?.category.is_locked;
  const composerTopic =
    view === "topic" ? slug : view === "questions" ? FORUM_QUESTION_TOPIC : undefined;
  const showComposer = !search && view !== "mine" && !topicLocked;

  return (
    <div className="ui-page feed-page">
      <header className="feed-header">
        <div>
          <h1>Discussions</h1>
          <p>Share what&apos;s on your mind, ask a question, or swap tips with buyers and providers.</p>
        </div>
        <ComposeButton defaultTopic={topicLocked ? undefined : composerTopic} />
      </header>
      <div className="feed-layout">
        <div className="feed-column">
          <nav className="feed-tabs" aria-label="Discussion feeds">
            {TABS.map((tab) => {
              const active = !search && tab.view === view;
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.view}
                  href={tab.href}
                  prefetch={false}
                  className={active ? "active" : ""}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon size={15} aria-hidden="true" />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
          {view === "topic" && slug && !search && <TopicBanner slug={slug} />}
          {topicLocked && !search && (
            <p className="feed-note">Only the team posts in this topic. You can read and reply.</p>
          )}
          {view === "unanswered" && !search && (
            <p className="feed-note">Posts nobody has replied to yet. Jump in.</p>
          )}
          {search && (
            <p className="feed-note" role="status">
              Results for “{search}” ·{" "}
              <button type="button" className="ui-link" onClick={() => setSearch("")}>
                Back to {pathname?.includes("/category/") ? "the topic" : "the feed"}
              </button>
            </p>
          )}
          {showComposer && <PostComposer key={view + (slug ?? "")} defaultTopic={composerTopic} />}
          {search ? (
            <SearchResults query={search} />
          ) : (
            <>
              <FeedList key={view + (slug ?? "")} view={view} slug={slug} />
              {view === "mine" && <MyReplies />}
            </>
          )}
        </div>
        <Rail
          key={view + (slug ?? "")}
          search={search}
          onSearch={setSearch}
          activeTopic={view === "topic" ? slug : undefined}
        />
      </div>
    </div>
  );
}
