import ForumHome from "@/app/community/forum/page";
import ForumPopular from "@/app/community/forum/popular/page";
import ForumRecent from "@/app/community/forum/recent/page";
import ForumUnanswered from "@/app/community/forum/unanswered/page";
import ForumMyPosts from "@/app/community/forum/my-posts/page";

type SearchParams = Promise<{
  sort?: string | string[];
  filter?: string | string[];
}>;

export default async function HelpForumPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const sort = Array.isArray(params.sort) ? params.sort[0] : params.sort;
  const filter = Array.isArray(params.filter) ? params.filter[0] : params.filter;

  if (filter === "mine") return <ForumMyPosts />;
  if (filter === "unanswered") return <ForumUnanswered />;
  if (sort === "popular") return <ForumPopular />;
  if (sort === "recent") return <ForumRecent />;
  return <ForumHome />;
}
