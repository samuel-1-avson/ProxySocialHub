"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eye, PenLine, Send } from "lucide-react";
import { getForumCategories, createThread } from "@/lib/forum-api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import {
  PageHeading,
  DataError,
  Loading,
} from "@/components/workspace/Patterns";

function NewDiscussion() {
  const router = useRouter();
  const params = useSearchParams();
  const client = useQueryClient();
  const categories = useQuery({
    queryKey: ["forum", "categories"],
    queryFn: getForumCategories,
  });
  const writable =
    categories.data?.categories.filter((category) => !category.is_locked) ?? [];
  const [draft, setDraft] = useState({
    title: "",
    content: "",
    category_slug: params.get("category") || "",
  });
  const [preview, setPreview] = useState(false);
  const [validation, setValidation] = useState("");
  const publish = useMutation({
    retry: false,
    mutationFn: () =>
      createThread({
        title: draft.title.trim(),
        content: draft.content.trim(),
        category_slug: draft.category_slug,
      }),
    onSuccess: (thread) => {
      void client.invalidateQueries({ queryKey: ["forum"] });
      router.push("/help/forum/thread/" + encodeURIComponent(thread.id));
    },
  });
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setValidation("");
    if (
      draft.title.trim().length < 5 ||
      draft.title.trim().length > 200 ||
      draft.content.trim().length < 10
    ) {
      setValidation(
        "Use a title of 5–200 characters and a discussion of at least 10 characters.",
      );
      return;
    }
    if (!writable.some((category) => category.slug === draft.category_slug)) {
      setValidation("Choose an available category before publishing.");
      return;
    }
    publish.mutate();
  }
  return (
    <div className="ui-page discussion-composer">
      <Link href="/help/forum" className="ui-button ghost self-start">
        <ArrowLeft size={15} />
        Back to forum
      </Link>
      <PageHeading
        eyebrow="Community / New discussion"
        title="Start a conversation"
        description="Ask a specific question, share something useful, or open a thoughtful discussion."
      />
      <div className="discussion-composer-layout">
        <section className="ui-surface discussion-editor">
          <div className="ui-tabs" aria-label="Editor view">
            <button
              type="button"
              className={!preview ? "active" : ""}
              aria-pressed={!preview}
              onClick={() => setPreview(false)}
            >
              <PenLine size={15} />
              Write
            </button>
            <button
              type="button"
              className={preview ? "active" : ""}
              aria-pressed={preview}
              onClick={() => setPreview(true)}
            >
              <Eye size={15} />
              Preview
            </button>
          </div>
          {categories.isPending && (
            <Loading label="Loading forum categories…" />
          )}
          {categories.isError && (
            <DataError
              title="Categories could not be loaded"
              error={categories.error}
              retry={() => void categories.refetch()}
            />
          )}
          {categories.isSuccess && writable.length === 0 && (
            <p className="workflow-note">
              No writable categories are currently available. You can still
              browse existing discussions.
            </p>
          )}
          {publish.isError && (
            <DataError
              title="Your discussion was not published"
              error={publish.error}
            />
          )}
          {validation && (
            <p className="ui-error" role="alert">
              {validation}
            </p>
          )}
          <form onSubmit={submit} className="ui-page">
            <label className="ui-field">
              Category
              <select
                aria-label="Category"
                className="ui-select"
                required
                value={draft.category_slug}
                onChange={(event) =>
                  setDraft({ ...draft, category_slug: event.target.value })
                }
              >
                <option value="">Choose a topic</option>
                {writable.map((category) => (
                  <option value={category.slug} key={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            {preview ? (
              <article className="discussion-preview">
                <p className="ui-eyebrow">Discussion preview</p>
                <h2>{draft.title || "Your discussion title"}</h2>
                <p>{draft.content || "Your message will appear here."}</p>
              </article>
            ) : (
              <>
                <label className="ui-field">
                  Discussion title
                  <input
                    aria-label="Discussion title"
                    className="ui-input"
                    value={draft.title}
                    onChange={(event) =>
                      setDraft({ ...draft, title: event.target.value })
                    }
                    required
                    minLength={5}
                    maxLength={200}
                    placeholder="What would you like to discuss?"
                  />
                </label>
                <label className="ui-field">
                  Message
                  <textarea
                    aria-label="Message"
                    className="ui-input"
                    rows={12}
                    value={draft.content}
                    onChange={(event) =>
                      setDraft({ ...draft, content: event.target.value })
                    }
                    required
                    minLength={10}
                    placeholder="Describe your goal, the details, and what you have tried."
                  />
                </label>
                <p className="ui-subtle">
                  {draft.title.length}/200 title characters ·{" "}
                  {draft.content.length} message characters
                </p>
              </>
            )}
            <div className="ui-actions">
              <button
                className="ui-button"
                type="submit"
                disabled={publish.isPending || writable.length === 0}
              >
                <Send size={15} />
                {publish.isPending ? "Publishing…" : "Publish discussion"}
              </button>
              <Link className="ui-button secondary" href="/help/forum">
                Cancel
              </Link>
            </div>
          </form>
        </section>
        <aside className="forum-guidance ui-surface">
          <p className="ui-eyebrow">Give others a useful starting point</p>
          <h2>A little context goes a long way.</h2>
          <ul>
            <li>Search for an existing answer first.</li>
            <li>Describe one clear question or idea.</li>
            <li>Include relevant steps and error messages.</li>
            <li>Keep passwords, tokens, and wallet secrets private.</li>
          </ul>
          <Link href="/guidelines" className="ui-link">
            Read the community guidelines →
          </Link>
        </aside>
      </div>
    </div>
  );
}
export default function NewThreadPage() {
  return (
    <ProtectedRoute>
      <NewDiscussion />
    </ProtectedRoute>
  );
}
