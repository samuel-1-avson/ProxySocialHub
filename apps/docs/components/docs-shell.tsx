'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { NAV, SEARCH_INDEX, navGroupActive, type NavItem } from '@/lib/nav';

type Theme = 'dark' | 'light';

type SearchDoc = {
  href: string;
  title: string;
  description: string;
  section: string;
  text?: string;
};

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    const stored = window.localStorage.getItem('phub-docs-theme') as Theme | null;
    const next = stored === 'light' || stored === 'dark' ? stored : 'dark';
    setThemeState(next);
    document.documentElement.setAttribute('data-theme', next);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    document.documentElement.setAttribute('data-theme', t);
    window.localStorage.setItem('phub-docs-theme', t);
  }, []);

  return [theme, setTheme];
}

const RECENT_KEY = 'phub-docs-recent';
const JUMP_LINKS: Array<SearchDoc & { hit: string }> = [
  {
    href: '/docs/api',
    title: 'API reference',
    description: 'OpenAPI Try It',
    section: 'Jump',
    hit: 'Interactive OpenAPI',
  },
  {
    href: '/docs/quickstart/buyer',
    title: 'Buyer quickstart',
    description: '5 min CONNECT',
    section: 'Jump',
    hit: 'First successful CONNECT',
  },
  {
    href: '/docs/quickstart/provider',
    title: 'Provider quickstart',
    description: '10 min node online',
    section: 'Jump',
    hit: 'CLI doctor → tunnel',
  },
  {
    href: '/docs/troubleshooting',
    title: 'Troubleshooting',
    description: '401 → 501',
    section: 'Jump',
    hit: 'Common proxy and API errors',
  },
];

type SearchHit = SearchDoc & { hit: string };
type SearchRow =
  | { kind: 'group'; label: string; key: string }
  | { kind: 'hit'; hit: SearchHit; index: number };

function snippet(text: string, needle: string, max = 120): string {
  const lower = text.toLowerCase();
  const i = lower.indexOf(needle);
  if (i < 0) return text.slice(0, max);
  const start = Math.max(0, i - 40);
  const end = Math.min(text.length, i + needle.length + 60);
  const piece = text.slice(start, end).replace(/\s+/g, ' ');
  return `${start > 0 ? '…' : ''}${piece}${end < text.length ? '…' : ''}`;
}

function highlight(text: string, needle: string): ReactNode {
  if (!needle.trim()) return text;
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  const i = lower.indexOf(n);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="search-mark">{text.slice(i, i + n.length)}</mark>
      {text.slice(i + n.length)}
    </>
  );
}

function readRecent(): SearchHit[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SearchHit[];
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    return [];
  }
}

function pushRecent(entry: SearchHit) {
  try {
    const next = [entry, ...readRecent().filter((e) => e.href !== entry.href)].slice(0, 5);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function SearchPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [corpus, setCorpus] = useState<SearchDoc[] | null>(null);
  const [recent, setRecent] = useState<SearchHit[]>([]);
  const listId = useId();

  useEffect(() => {
    if (!open || corpus) return;
    let cancelled = false;
    fetch('/search-index.json')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: SearchDoc[]) => {
        if (!cancelled && Array.isArray(data)) setCorpus(data);
      })
      .catch(() => {
        if (!cancelled) setCorpus(SEARCH_INDEX);
      });
    return () => {
      cancelled = true;
    };
  }, [open, corpus]);

  useEffect(() => {
    if (!open) return;
    setRecent(readRecent());
  }, [open]);

  const results = useMemo(() => {
    const docs = corpus ?? SEARCH_INDEX;
    const needle = q.trim().toLowerCase();
    if (!needle) {
      const out: SearchHit[] = [...JUMP_LINKS];
      for (const r of recent) {
        if (!out.some((e) => e.href === r.href)) out.push({ ...r, hit: r.hit || r.description });
      }
      for (const d of docs.slice(0, 6)) {
        if (!out.some((e) => e.href === d.href)) {
          out.push({ ...d, hit: d.description });
        }
      }
      return out.slice(0, 12);
    }
    return docs
      .map((e) => {
        const hay = `${e.title} ${e.description} ${e.section} ${e.text || ''}`.toLowerCase();
        if (!hay.includes(needle)) return null;
        const hit =
          e.title.toLowerCase().includes(needle) || e.description.toLowerCase().includes(needle)
            ? e.description
            : snippet(e.text || e.description, needle);
        const score =
          (e.title.toLowerCase().includes(needle) ? 0 : 2) +
          (e.description.toLowerCase().includes(needle) ? 0 : 1);
        return { ...e, hit, score };
      })
      .filter(Boolean)
      .sort((a, b) => (a!.score ?? 0) - (b!.score ?? 0))
      .slice(0, 12) as SearchHit[];
  }, [q, corpus, recent]);

  const rows = useMemo(() => {
    const needle = q.trim();
    const grouped = new Map<string, SearchHit[]>();
    for (const hit of results) {
      const label = !needle
        ? hit.section === 'Jump'
          ? 'Jump to'
          : recent.some((r) => r.href === hit.href)
            ? 'Recent'
            : hit.section || 'Docs'
        : hit.section || 'Docs';
      const list = grouped.get(label) ?? [];
      list.push(hit);
      grouped.set(label, list);
    }
    const out: SearchRow[] = [];
    let index = 0;
    for (const [label, hits] of grouped) {
      out.push({ kind: 'group', label, key: label });
      for (const hit of hits) {
        out.push({ kind: 'hit', hit, index });
        index += 1;
      }
    }
    return out;
  }, [results, q, recent]);

  useEffect(() => {
    setActive(0);
  }, [q, results.length]);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [open]);

  const go = useCallback(
    (hit: SearchHit) => {
      pushRecent({
        href: hit.href,
        title: hit.title,
        description: hit.description,
        section: hit.section,
        hit: hit.hit,
      });
      onClose();
      router.push(hit.href);
    },
    [onClose, router],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter' && results[active]) {
        e.preventDefault();
        go(results[active]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, results, active, go]);

  if (!open) return null;

  const needle = q.trim();

  return (
    <div className="search-overlay" role="dialog" aria-modal="true" aria-label="Search docs">
      <button type="button" className="search-backdrop" aria-label="Close search" onClick={onClose} />
      <div className="search-panel">
        <label htmlFor={listId + '-q'} className="sr-only">
          Search documentation
        </label>
        <input
          ref={inputRef}
          id={listId + '-q'}
          className="search-input"
          placeholder="Search docs…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results[active] ? `search-hit-${active}` : undefined}
        />
        {results.length === 0 ? (
          <p className="search-empty" role="status">
            No matches for “{needle}”. Try CONNECT, escrow, pool, or JWT.
          </p>
        ) : (
        <ul id={listId} className="search-results" role="listbox">
          {rows.map((row) =>
              row.kind === 'group' ? (
                <li key={`g-${row.key}`} className="search-group" role="presentation">
                  {row.label}
                </li>
              ) : (
                <li
                  key={`${row.hit.href}-${row.index}`}
                  role="option"
                  aria-selected={row.index === active}
                  id={`search-hit-${row.index}`}
                >
                  <button
                    type="button"
                    className={`search-hit${row.index === active ? ' active' : ''}`}
                    onMouseEnter={() => setActive(row.index)}
                    onClick={() => go(row.hit)}
                  >
                    <span className="search-hit-title">{highlight(row.hit.title, needle)}</span>
                    <span className="search-hit-meta">{row.hit.section}</span>
                    <span className="search-hit-desc">
                      {highlight(row.hit.hit || row.hit.description, needle)}
                    </span>
                  </button>
                </li>
              ),
            )}
        </ul>
        )}
        <p className="search-hint">
          <kbd>↑</kbd>
          <kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close
        </p>
      </div>
    </div>
  );
}

function NavSection({
  item,
  current,
  open,
  onToggle,
}: {
  item: NavItem;
  current: string;
  open: boolean;
  onToggle: () => void;
}) {
  const active = navGroupActive(item, current);
  const code = item.code ?? '••';

  if (!item.children?.length) {
    return (
      <div className={`nav-section${active ? ' is-active' : ''}`}>
        <Link
          href={item.href}
          className={`nav-link top${current === item.href ? ' active' : ''}`}
          aria-current={current === item.href ? 'page' : undefined}
        >
          <span className="nav-code" aria-hidden="true">
            {code}
          </span>
          <span>{item.label}</span>
        </Link>
      </div>
    );
  }

  return (
    <div className={`nav-section${active || open ? ' is-open' : ''}${active ? ' is-active' : ''}`}>
      <button
        type="button"
        className="nav-group-btn"
        aria-expanded={open || active}
        onClick={onToggle}
      >
        <span className="nav-code" aria-hidden="true">
          {code}
        </span>
        <span className="nav-group-label">{item.label}</span>
        <span className="nav-chevron" aria-hidden="true">
          {(open || active) ? '−' : '+'}
        </span>
      </button>
      {(open || active) && (
        <div className="nav-children">
          {item.children.map((child) => (
            <Link
              key={child.href}
              href={child.href}
              className={`nav-link${current === child.href ? ' active' : ''}`}
              aria-current={current === child.href ? 'page' : undefined}
            >
              {child.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function DocsShell({
  children,
  activePath,
}: {
  children: ReactNode;
  activePath: string;
}) {
  const pathname = usePathname();
  const current = activePath || pathname || '/docs';
  const [theme, setTheme] = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const item of NAV) {
      if (item.children && navGroupActive(item, current)) {
        next[item.label] = true;
      }
    }
    setOpenGroups((prev) => ({ ...prev, ...next }));
  }, [current]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (typing) return;
      if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('nav-lock', navOpen || searchOpen);
  }, [navOpen, searchOpen]);

  return (
    <div className="shell">
      <a href="#doc-main" className="skip-link">
        Skip to content
      </a>

      <header className="mobile-bar">
        <button
          type="button"
          className="icon-btn"
          aria-expanded={navOpen}
          aria-controls="docs-sidebar"
          onClick={() => setNavOpen((v) => !v)}
        >
          {navOpen ? 'Close' : 'Menu'}
        </button>
        <Link href="/docs" className="mobile-brand">
          ProxyHubb <span>Docs</span>
        </Link>
        <span className="mobile-bar-spacer" aria-hidden="true" />
      </header>

      {navOpen ? (
        <button
          type="button"
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <aside
        id="docs-sidebar"
        className={`sidebar${navOpen ? ' open' : ''}`}
        aria-label="Docs navigation"
      >
        <div className="brand-block">
          <Link href="/docs" className="brand">
            <span className="brand-mark" aria-hidden="true">
              PH
            </span>
            <span className="brand-text">
              ProxyHubb
              <span className="brand-sub">Docs</span>
            </span>
          </Link>
          <p className="brand-tag">Control plane manual</p>
        </div>

        <div className="sidebar-tools">
          <button type="button" className="search-trigger" onClick={() => setSearchOpen(true)} aria-label="Search documentation">
            <span>Search</span>
            <kbd>/</kbd>
          </button>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>

        <div className="topbar">
          <a href="https://proxyhubb.com" target="_blank" rel="noopener noreferrer">
            App
          </a>
          <a href="https://api.proxyhubb.com" target="_blank" rel="noopener noreferrer">
            API
          </a>
          <a href="/docs/changelog">Changelog</a>
        </div>

        <nav aria-label="Documentation" className="nav-rail">
          {NAV.map((item) => (
            <NavSection
              key={item.label + item.href}
              item={item}
              current={current}
              open={Boolean(openGroups[item.label])}
              onToggle={() =>
                setOpenGroups((prev) => ({
                  ...prev,
                  [item.label]: !prev[item.label],
                }))
              }
            />
          ))}
        </nav>
      </aside>

      <main id="doc-main" className="main" tabIndex={-1}>
        {children}
      </main>

      <nav className="mobile-dock" aria-label="Quick actions">
        <button
          type="button"
          className="dock-btn"
          onClick={() => setSearchOpen(true)}
          aria-label="Search documentation"
        >
          Search
        </button>
        <button
          type="button"
          className="dock-btn"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
        <a
          className="dock-btn"
          href="https://proxyhubb.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          App
        </a>
      </nav>

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
