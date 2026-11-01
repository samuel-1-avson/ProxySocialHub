"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HelpCircle, Loader2, MessageSquare, Send } from "lucide-react";
import {
  askListingQuestion,
  fetchListingQA,
  type ListingQAResponse,
} from "@/lib/api/listing-social";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/stores";

interface ListingQASectionProps {
  listingId: string;
  compact?: boolean;
  className?: string;
}

export function ListingQASection({
  listingId,
  compact = false,
  className = "",
}: ListingQASectionProps) {
  const { isAuthenticated } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const queryKey = ["listing-qa", listingId];
  const { data, isPending, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchListingQA(listingId),
  });
  const questions = data?.questions ?? [];
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isAuthenticated) {
      toast.warning(
        "Sign in required",
        "Sign in to ask a question about this listing.",
      );
      return;
    }
    if (title.trim().length < 5 || content.trim().length < 10) {
      toast.warning(
        "Too short",
        "Use at least 5 characters for the title and 10 for the question.",
      );
      return;
    }
    setSubmitting(true);
    try {
      const thread = await askListingQuestion(listingId, {
        title: title.trim(),
        content: content.trim(),
      });
      queryClient.setQueryData<ListingQAResponse>(queryKey, (previous) => ({
        questions: [thread, ...(previous?.questions ?? [])],
        count: (previous?.count ?? 0) + 1,
      }));
      setTitle("");
      setContent("");
      setShowForm(false);
      toast.success(
        "Question posted",
        "The provider and community can reply on the thread.",
      );
    } catch (error) {
      toast.error(
        "Could not post question",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-label="Questions and answers"
      className={
        "listing-qa ui-surface " + (compact ? "compact " : "") + className
      }
    >
      <div className="section-heading">
        <div>
          <p className="ui-eyebrow">Before you connect</p>
          <h2>
            <HelpCircle size={19} aria-hidden="true" />
            Questions & answers
          </h2>
        </div>
        {!compact && questions.length > 0 && (
          <span className="ui-subtle">{questions.length} threads</span>
        )}
      </div>
      {isPending ? (
        <p role="status" className="listing-social-loading">
          <Loader2 size={15} className="animate-spin" />
          Loading questions…
        </p>
      ) : isError ? (
        <div role="alert" className="workflow-note">
          <p>Questions could not be loaded.</p>
          <button
            type="button"
            className="ui-link"
            onClick={() => void refetch()}
          >
            Try again
          </button>
        </div>
      ) : questions.length === 0 ? (
        <p className="listing-qa-empty">
          No questions yet. Ask about latency, routing, or availability before
          you buy.
        </p>
      ) : (
        <ul className="listing-question-list">
          {questions.slice(0, compact ? 5 : 20).map((question) => (
            <li key={question.id}>
              <Link href={"/community/forum/thread/" + question.id}>
                <strong>{question.title}</strong>
                <span>
                  <MessageSquare size={13} aria-hidden="true" />
                  {question.replies_count} replies
                  {(question.author?.display_name ||
                    question.author?.username) &&
                    " · " +
                      (question.author?.display_name ||
                        question.author?.username)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {showForm ? (
        <form onSubmit={handleSubmit} className="listing-question-form">
          <label>
            Question title
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What would you like to know?"
              required
              minLength={5}
              maxLength={200}
            />
          </label>
          <label>
            Details
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Include the details that will help the provider answer."
              required
              minLength={10}
              rows={compact ? 3 : 4}
              maxLength={2000}
            />
          </label>
          <div className="ui-actions">
            <button type="submit" disabled={submitting} className="ui-button">
              {submitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              Post question
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="ui-button secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="ui-button secondary"
          onClick={() => {
            if (!isAuthenticated) {
              toast.warning("Sign in required", "Sign in to ask a question.");
              return;
            }
            setShowForm(true);
          }}
        >
          Ask a question
        </button>
      )}
    </section>
  );
}
