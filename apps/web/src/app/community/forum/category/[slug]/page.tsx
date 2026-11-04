"use client";

import { useParams } from "next/navigation";
import { ForumFeed } from "@/components/community/ForumFeed";

export default function ForumCategoryPage() {
  const { slug } = useParams<{ slug: string }>();
  return <ForumFeed key={slug} view="topic" slug={slug} />;
}
