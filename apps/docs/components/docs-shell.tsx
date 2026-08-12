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
import { NAV, SEARCH_INDEX } from '@/lib/nav';

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

function snippet(text: string, needle: string, max = 120): string {
  const lower = text.toLowerCase();
  const i = lower.indexOf(needle);
  if (i < 0) return text.slice(0, max);
  const start = Math.max(0, i - 40);
  const end = Math.min(text.length, i + needle.length + 60);
  const piece = text.slice(start, end).replace(/\s+/g, ' ');
  return `${start > 0 ? '…' : ''}${piece}${end < text.length ? '…' : ''}`;
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
  const [corpus, setCorpus] = useState<SearchDoc[] | null>(null);
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

  const results = useMemo(() => {
    const docs = corpus ?? SEARCH_INDEX;
    const needle = q.trim().toLowerCase();
    if (!needle) return docs.slice(0, 8).map((d) => ({ ...d, hit: d.description }));
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
      .slice(0, 12) as Array<SearchDoc & { hit: string }>;
  }, [q, corpus]);

  useEffect(() => {
    if (!open) return;
    setQ('');
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="search-overlay" role="dialog" aria-modal="true" aria-label="Search docs">
      <button type="button" className="search-backdrop" aria-label="Close search" onClick={onClose} />
      <div className="search-panel">
        <input
          ref={inputRef}
          className="search-input"
          placeholder="Search docs…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-controls={listId}
          aria-autocomplete="list"
        />
        <ul id={listId} className="search-results">
          {results.length === 0 ? (
            <li className="search-empty">No matches</li>
          ) : (
            results.map((r) => (
              <li key={r.href}>
                <button
                  type="button"
                  className="search-hit"
                  onClick={() => {
                    onClose();
                    router.push(r.href);
                  }}
                >
                  <span className="search-hit-title">{r.title}</span>
                  <span className="search-hit-meta">{r.section}</span>
                  <span className="search-hit-desc">{r.hit || r.description}</span>
                </button>
              </li>
            ))
          )}
        </ul>
        <p className="search-hint">
          <kbd>Esc</kbd> close · <kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>K</kbd> open
        </p>
      </div>
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

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

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
        <button type="button" className="icon-btn" onClick={() => setSearchOpen(true)}>
          Search
        </button>
      </header>

      {navOpen ? (
        <button
          type="button"
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <aside id="docs-sidebar" className={`sidebar${navOpen ? ' open' : ''}`}>
        <div className="brand-row">
          <Link href="/docs" className="brand">
            ProxyHubb <span>Docs</span>
          </Link>
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
          <a href="https://proxyhubb.com" target="_blank" rel="noreferrer">
            App
          </a>
          <a href="https://api.proxyhubb.com" target="_blank" rel="noreferrer">
            API
          </a>
          <button type="button" className="search-trigger" onClick={() => setSearchOpen(true)}>
            Search <kbd>/</kbd>
          </button>
        </div>

        <nav aria-label="Documentation">
          {NAV.map((item) => (
            <div key={item.href + item.label} className="nav-section">
              {item.children ? (
                <>
                  <span className="nav-label">{item.label}</span>
                  {item.children.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      className={`nav-link${current === child.href ? ' active' : ''}`}
                    >
                      {child.label}
                    </Link>
                  ))}
                </>
              ) : (
                <Link
                  href={item.href}
                  className={`nav-link${current === item.href ? ' active' : ''}`}
                >
                  {item.label}
                </Link>
              )}
            </div>
          ))}
        </nav>
      </aside>

      <main className="main">{children}</main>

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
