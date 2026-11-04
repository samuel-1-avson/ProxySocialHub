"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PostComposer } from "@/components/community/PostComposer";
import { threadPath } from "@/components/community/ForumThreadCard";

function NewPost() {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <div className="ui-page feed-page">
      <Link href="/help/forum" className="ui-button ghost self-start">
        <ArrowLeft size={15} aria-hidden="true" />
        Back to discussions
      </Link>
      <header className="feed-header">
        <div>
          <h1>Create a post</h1>
          <p>
            Text is all you need. Add a title, a topic, or mark it as a
            question if you like.
          </p>
        </div>
      </header>
      <div className="feed-layout">
        <PostComposer
          standalone
          autoFocus
          defaultTopic={params.get("category") || ""}
          onPosted={(thread) => router.push(threadPath(thread))}
        />
      </div>
    </div>
  );
}

export default function NewThreadPage() {
  return (
    <ProtectedRoute>
      <NewPost />
    </ProtectedRoute>
  );
}
