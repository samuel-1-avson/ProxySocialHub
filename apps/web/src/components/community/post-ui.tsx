"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { CheckCircle2, HelpCircle, LockKeyhole, Pin } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import {
  FORUM_DEFAULT_TOPIC,
  FORUM_QUESTION_TOPIC,
  type ForumThread,
} from "@/lib/forum-api";

/** The person shown on a post. */
export type PostPerson = {
  id?: string;
  username?: string;
  display_name?: string;
  avatar_url?: string;
};

/** Ends a message with punctuation so a hint can follow it. */
export function asSentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : trimmed + ".";
}

export function personName(person?: PostPerson | null): string {
  return person?.display_name || person?.username || "Community member";
}

export function personHref(person?: PostPerson | null, fallbackId?: string) {
  const key = person?.username || person?.id || fallbackId;
  return key ? "/profile/" + encodeURIComponent(key) : undefined;
}

function initials(person?: PostPerson | null): string {
  const source = (person?.display_name || person?.username || "").trim();
  if (!source) return "?";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  const letters =
    words.length > 1
      ? Array.from(words[0])[0] + Array.from(words[1])[0]
      : Array.from(source).slice(0, 2).join("");
  return letters.toUpperCase();
}

export function PostAvatar({
  person,
  small = false,
}: {
  person?: PostPerson | null;
  small?: boolean;
}) {
  return (
    <span className={"post-avatar" + (small ? " small" : "")} aria-hidden="true">
      {person?.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={person.avatar_url} alt="" loading="lazy" />
      ) : (
        initials(person)
      )}
    </span>
  );
}

/** "2m", "3h", "5d" like a timeline; full date for anything older than a week. */
export function shortTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const ageMs = Date.now() - date.getTime();
  if (ageMs < 60_000) return "now";
  if (ageMs < 7 * 24 * 60 * 60 * 1000) {
    const [amount, unit] = formatDistanceToNowStrict(date).split(" ");
    return amount + (unit?.[0] ?? "");
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

export function fullTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";
}

export function compactCount(value: number | undefined): string {
  const n = Math.max(0, value ?? 0);
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "") + "K";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
}

// Links, #topics and @mentions inside a post's text. Built with RegExp
// because the TypeScript target (ES2017) rejects \p{…} in a literal; every
// supported browser understands it.
const TOKEN = new RegExp(
  String.raw`(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]|(?<![\p{L}\p{N}_.])#[\p{L}\p{N}_]{1,50}|(?<![\p{L}\p{N}_.])@[A-Za-z0-9_]{2,40})`,
  "gu",
);

function RichText({ text }: { text: string }) {
  const parts = text.split(TOKEN);
  return (
    <>
      {parts.map((part, index) => {
        if (index % 2 === 0) return <Fragment key={index}>{part}</Fragment>;
        if (part.startsWith("http")) {
          return (
            <a
              key={index}
              href={part}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              onClick={(event) => event.stopPropagation()}
            >
              {part.replace(/^https?:\/\//, "")}
            </a>
          );
        }
        if (part.startsWith("@")) {
          return (
            <Link
              key={index}
              className="post-tag"
              href={"/profile/" + encodeURIComponent(part.slice(1))}
              onClick={(event) => event.stopPropagation()}
            >
              {part}
            </Link>
          );
        }
        return (
          <span key={index} className="post-tag">
            {part}
          </span>
        );
      })}
    </>
  );
}

const LONG_POST_CHARS = 320;
const LONG_POST_LINES = 6;

/** A post's text with links highlighted; long text folds behind "Show more". */
export function PostText({
  text,
  fold = true,
  className = "",
}: {
  text: string;
  fold?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const long =
    fold &&
    (Array.from(text).length > LONG_POST_CHARS ||
      text.split("\n").length > LONG_POST_LINES);
  return (
    <>
      <p className={"post-text " + (long && !open ? "clamped " : "") + className}>
        <RichText text={text} />
      </p>
      {long && (
        <button
          type="button"
          className="post-show-more"
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}

/** Topic, question/solved, pinned and locked labels for a post. */
export function PostBadges({ thread }: { thread: ForumThread }) {
  const slug = thread.category?.slug;
  const isQuestion = slug === FORUM_QUESTION_TOPIC;
  const showTopic = !!thread.category && !isQuestion && slug !== FORUM_DEFAULT_TOPIC;
  if (!showTopic && !isQuestion && !thread.is_pinned && !thread.is_locked && !thread.is_hidden) {
    return null;
  }
  return (
    <div className="post-badges">
      {thread.is_pinned && (
        <span className="post-badge">
          <Pin size={11} aria-hidden="true" />
          Pinned
        </span>
      )}
      {isQuestion &&
        (thread.has_solution ? (
          <span className="post-badge solved">
            <CheckCircle2 size={11} aria-hidden="true" />
            Question · solved
          </span>
        ) : (
          <span className="post-badge question">
            <HelpCircle size={11} aria-hidden="true" />
            Question
          </span>
        ))}
      {showTopic && thread.category && (
        <Link
          className="post-badge topic"
          href={"/help/forum/category/" + encodeURIComponent(thread.category.slug)}
          onClick={(event) => event.stopPropagation()}
        >
          #{thread.category.name}
        </Link>
      )}
      {thread.is_locked && (
        <span className="post-badge warning">
          <LockKeyhole size={11} aria-hidden="true" />
          Locked
        </span>
      )}
      {thread.is_hidden && <span className="post-badge warning">Hidden</span>}
    </div>
  );
}
