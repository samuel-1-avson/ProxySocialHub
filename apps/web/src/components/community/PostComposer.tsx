"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hash, Heading, HelpCircle, Smile, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  createThread,
  FORUM_POST_MAX,
  FORUM_QUESTION_TOPIC,
  FORUM_TITLE_MAX,
  forumCharCount,
  getForumCategories,
  type ForumThread,
} from "@/lib/forum-api";
import { asSentence, PostAvatar } from "./post-ui";

const EMOJI = [
  "👋", "👍", "🙌", "🔥", "🚀", "🎉", "😄", "😂",
  "🙏", "❤️", "💡", "✅", "❓", "👀", "🤔", "😎",
  "🥳", "💪", "🌍", "⚡", "📈", "💰", "🛠️", "🐛",
  "🔒", "📡", "🌐", "⏱️", "😅", "🤝", "✨", "💬",
];

type Popover = "emoji" | "topic" | null;

/**
 * The "What's happening?" box. Text is the only required part; a title, a
 * topic and the question flag are optional extras from the toolbar.
 */
export function PostComposer({
  defaultTopic = "",
  autoFocus = false,
  standalone = false,
  onPosted,
}: {
  /** Topic slug to start with (for example on a topic page). */
  defaultTopic?: string;
  autoFocus?: boolean;
  /** Rounded box on its own instead of the top row of a feed. */
  standalone?: boolean;
  onPosted?: (thread: ForumThread) => void;
}) {
  const { user, isAuthenticated } = useAuth();
  const pathname = usePathname() || "/help/forum";
  const client = useQueryClient();
  const ids = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [showTitle, setShowTitle] = useState(false);
  const [topic, setTopic] = useState(
    defaultTopic === FORUM_QUESTION_TOPIC ? "" : defaultTopic,
  );
  const [question, setQuestion] = useState(
    defaultTopic === FORUM_QUESTION_TOPIC,
  );
  const [popover, setPopover] = useState<Popover>(null);
  const [focused, setFocused] = useState(false);
  const [posted, setPosted] = useState<ForumThread | null>(null);
  const categories = useQuery({
    queryKey: ["forum", "categories"],
    queryFn: getForumCategories,
    enabled: isAuthenticated,
  });
  const topics = (categories.data?.categories ?? []).filter(
    (category) => !category.is_locked && category.slug !== FORUM_QUESTION_TOPIC,
  );
  const questionsOpen = (categories.data?.categories ?? []).some(
    (category) => category.slug === FORUM_QUESTION_TOPIC && !category.is_locked,
  );
  const topicName = topics.find((category) => category.slug === topic)?.name;

  const count = forumCharCount(text);
  const left = FORUM_POST_MAX - count;
  const titleCount = Array.from(title.trim()).length;
  const tooLong = left < 0 || titleCount > FORUM_TITLE_MAX;
  const canPost = count > 0 && !tooLong;

  const publish = useMutation({
    retry: false,
    mutationFn: () =>
      createThread({
        content: text.trim(),
        title: showTitle ? title.trim() || undefined : undefined,
        category_slug: question ? FORUM_QUESTION_TOPIC : topic || undefined,
      }),
    onSuccess: (thread) => {
      setText("");
      setTitle("");
      setShowTitle(false);
      setQuestion(defaultTopic === FORUM_QUESTION_TOPIC);
      setTopic(defaultTopic === FORUM_QUESTION_TOPIC ? "" : defaultTopic);
      setPosted(thread);
      void client.invalidateQueries({ queryKey: ["forum"] });
      onPosted?.(thread);
    },
  });

  useEffect(() => {
    if (autoFocus) textRef.current?.focus();
  }, [autoFocus]);

  // Grow the text box with its content.
  useEffect(() => {
    const box = textRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = Math.min(box.scrollHeight, 480) + "px";
  }, [text]);

  useEffect(() => {
    if (!posted) return;
    const timer = window.setTimeout(() => setPosted(null), 6000);
    return () => window.clearTimeout(timer);
  }, [posted]);

  // Close the emoji or topic menu on an outside click or Escape.
  useEffect(() => {
    if (!popover) return;
    function onPointer(event: MouseEvent) {
      if (!toolbarRef.current?.contains(event.target as Node)) setPopover(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPopover(null);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [popover]);

  if (!isAuthenticated) {
    return (
      <div className="post-signin">
        <span>Sign in to share something with the community.</span>
        <Link
          className="ui-button small"
          href={"/login?next=" + encodeURIComponent(pathname)}
        >
          Sign in
        </Link>
      </div>
    );
  }

  function insertEmoji(emoji: string) {
    const box = textRef.current;
    const start = box?.selectionStart ?? text.length;
    const end = box?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    setPopover(null);
    requestAnimationFrame(() => {
      box?.focus();
      const caret = start + emoji.length;
      box?.setSelectionRange(caret, caret);
    });
  }

  function submit() {
    if (!canPost || publish.isPending) return;
    publish.mutate();
  }

  const ringSize = 22;
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(count / FORUM_POST_MAX, 1);
  const expanded = focused || count > 0 || showTitle || question || !!topic;

  return (
    <form
      className={"post-composer" + (standalone ? " standalone" : "")}
      aria-label="Create a post"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <PostAvatar person={user} />
      <div className="post-composer-body">
        {showTitle && (
          <input
            className="post-composer-title"
            aria-label="Post title (optional)"
            placeholder="Title (optional)"
            value={title}
            maxLength={FORUM_TITLE_MAX + 20}
            onChange={(event) => setTitle(event.target.value)}
          />
        )}
        <textarea
          ref={textRef}
          id={ids + "-text"}
          aria-label="Post text"
          rows={1}
          value={text}
          placeholder={
            question
              ? "What do you want to ask the community?"
              : "What's happening on the network?"
          }
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            setText(event.target.value);
            if (publish.isError) publish.reset();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
        />
        {(question || topicName) && (
          <div className="post-composer-chips">
            {question && (
              <span className="post-chip">
                <HelpCircle size={13} aria-hidden="true" />
                Question
                <button
                  type="button"
                  aria-label="Post without the question label"
                  onClick={() => setQuestion(false)}
                >
                  <X size={12} />
                </button>
              </span>
            )}
            {topicName && !question && (
              <span className="post-chip">
                #{topicName}
                <button
                  type="button"
                  aria-label={"Remove the topic " + topicName}
                  onClick={() => setTopic("")}
                >
                  <X size={12} />
                </button>
              </span>
            )}
          </div>
        )}
        {expanded && (
          <p className="post-composer-hint">
            Everyone can see and reply. Keep passwords, tokens, and wallet
            secrets out of posts.
          </p>
        )}
        {publish.isError && (
          <p className="post-error" role="alert">
            {asSentence(
              publish.error instanceof Error
                ? publish.error.message
                : "Your post was not published",
            )}{" "}
            Your text is still here.
          </p>
        )}
        {titleCount > FORUM_TITLE_MAX && (
          <p className="post-error" role="alert">
            Titles can be at most {FORUM_TITLE_MAX} characters.
          </p>
        )}
        <div className="post-composer-toolbar" ref={toolbarRef}>
          <button
            type="button"
            className="post-tool"
            aria-label="Add emoji"
            aria-haspopup="true"
            aria-expanded={popover === "emoji"}
            onClick={() => setPopover(popover === "emoji" ? null : "emoji")}
          >
            <Smile size={19} />
          </button>
          <button
            type="button"
            className="post-tool"
            aria-label="Choose a topic"
            aria-haspopup="true"
            aria-expanded={popover === "topic"}
            disabled={topics.length === 0}
            onClick={() => setPopover(popover === "topic" ? null : "topic")}
          >
            <Hash size={19} />
          </button>
          {questionsOpen && (
            <button
              type="button"
              className="post-tool"
              aria-label="Ask a question"
              aria-pressed={question}
              onClick={() => setQuestion((value) => !value)}
            >
              <HelpCircle size={19} />
            </button>
          )}
          <button
            type="button"
            className="post-tool"
            aria-label="Add a title"
            aria-pressed={showTitle}
            onClick={() => setShowTitle((value) => !value)}
          >
            <Heading size={19} />
          </button>
          <span className="post-composer-spacer" />
          {count > 0 && (
            <span
              className={
                "post-counter" + (left < 0 ? " over" : left <= 50 ? " near" : "")
              }
            >
              <svg
                width={ringSize}
                height={ringSize}
                viewBox={`0 0 ${ringSize} ${ringSize}`}
                aria-hidden="true"
              >
                <circle
                  cx={ringSize / 2}
                  cy={ringSize / 2}
                  r={radius}
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth="2.5"
                />
                <circle
                  cx={ringSize / 2}
                  cy={ringSize / 2}
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - progress)}
                  transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`}
                />
              </svg>
              {left <= 50 && <span aria-hidden="true">{left}</span>}
              <span className="sr-only" aria-live="polite">
                {left >= 0
                  ? left + " characters left"
                  : -left + " characters over the limit"}
              </span>
            </span>
          )}
          <button
            className="ui-button post-submit"
            type="submit"
            disabled={!canPost || publish.isPending}
          >
            {publish.isPending ? "Posting…" : question ? "Ask" : "Post"}
          </button>
          {popover === "emoji" && (
            <div className="post-popover" role="dialog" aria-label="Emoji">
              <div className="post-emoji-grid">
                {EMOJI.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={"Insert " + emoji}
                    onClick={() => insertEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}
          {popover === "topic" && (
            <div className="post-popover" role="dialog" aria-label="Topics">
              <div className="post-topic-menu" role="radiogroup" aria-label="Topic">
                <p>Pick a topic so the right people see it. Optional.</p>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!topic && !question}
                  onClick={() => {
                    setTopic("");
                    setQuestion(false);
                    setPopover(null);
                  }}
                >
                  No topic
                </button>
                {topics.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    role="radio"
                    aria-checked={!question && topic === category.slug}
                    onClick={() => {
                      setTopic(category.slug);
                      setQuestion(false);
                      setPopover(null);
                    }}
                  >
                    #{category.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {posted && (
          <p className="post-flash" role="status">
            Posted.{" "}
            <Link
              className="ui-link"
              href={"/help/forum/thread/" + encodeURIComponent(posted.id)}
            >
              View your post
            </Link>
          </p>
        )}
      </div>
    </form>
  );
}
