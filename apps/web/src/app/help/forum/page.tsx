import { ForumFeed, type FeedView } from "@/components/community/ForumFeed";

type SearchParams = Promise<{
  sort?: string | string[];
  filter?: string | string[];
}>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const FILTER_VIEWS: Record<string, FeedView> = {
  mine: "mine",
  following: "following",
  questions: "questions",
  unanswered: "unanswered",
};

export default async function HelpForumPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const filter = first(params.filter);
  const sort = first(params.sort);
  const view: FeedView =
    (filter && FILTER_VIEWS[filter]) || (sort === "popular" ? "popular" : "latest");
  return <ForumFeed key={view} view={view} />;
}
