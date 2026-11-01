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
import { BrandSymbol, ThemeSymbol, ArrowSymbol, SearchSymbol } from '@/components/site-icons';

type Theme = 'system' | 'dark' | 'light';

type SearchDoc = {
  href: string;
  title: string;
  description: string;
  section: string;
  text?: string;
};

function useTheme(): [Theme, (t: Theme) => void, 'dark' | 'light', boolean] {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolved, setResolved] = useState<'dark' | 'light'>('dark');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('phub-docs-theme');
      if (stored === 'light' || stored === 'dark') setThemeState(stored);
    } catch { /* Appearance remains usable when storage is unavailable. */ }
    setReady(true);
    const sync = (event: StorageEvent) => {
      if (event.key === 'phub-docs-theme') {
        setThemeState(event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : 'system');
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      setResolved(dark ? 'dark' : 'light');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, ready]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { window.localStorage.setItem('phub-docs-theme', t); } catch { /* Optional persistence. */ }
  }, []);

  return [theme, setTheme, resolved, ready];
}

function ThemeControl({ resolved, ready, onChange }: { resolved: 'dark' | 'light'; ready: boolean; onChange: (theme: Theme) => void }) {
  return <button type="button" className="ph-theme-toggle" disabled={!ready} aria-label={ready ? `Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme` : 'Loading color theme'} onClick={() => onChange(resolved === 'dark' ? 'light' : 'dark')}><ThemeSymbol dark={resolved === 'dark'} /></button>;
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
  const dialogRef = useRef<HTMLDivElement>(null);
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
  const orderedHits = useMemo(() => rows.flatMap((row) => row.kind === 'hit' ? [row.hit] : []), [rows]);

  useEffect(() => {
    setActive(0);
  }, [q, results.length]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    setQ('');
    setActive(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      window.clearTimeout(t);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
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
      if (e.key === 'Tab') {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([tabindex="-1"]), input, a[href], select, [tabindex="0"]');
        if (controls?.length) {
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.target !== inputRef.current) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter' && orderedHits[active]) {
        e.preventDefault();
        go(orderedHits[active]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, results, orderedHits, active, go]);

  if (!open) return null;

  const needle = q.trim();

  return (
    <div ref={dialogRef} className="search-overlay" role="dialog" aria-modal="true" aria-label="Search docs">
      <button type="button" tabIndex={-1} className="search-backdrop" aria-label="Close search" onClick={onClose} />
      <div className="search-panel">
        <label htmlFor={listId + '-q'} className="sr-only">
          Search documentation
        </label>
        <input
          ref={inputRef}
          id={listId + '-q'}
          className="search-input"
          role="combobox"
          aria-expanded="true"
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
          <button type="button" className="search-close" onClick={onClose}>Close search</button>
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

  if (!item.children?.length) {
    return (
      <div className={`nav-section${active ? ' is-active' : ''}`}>
        <Link
          href={item.href}
          className={`nav-link top${current === item.href ? ' active' : ''}`}
          aria-current={current === item.href ? 'page' : undefined}
        >
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
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="nav-group-label">{item.label}</span>
        <span className="nav-chevron" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      {open && (
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
  const [theme, setTheme, resolved, themeReady] = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const closeOnDesktop = () => { if (!media.matches) setNavOpen(false); };
    media.addEventListener('change', closeOnDesktop);
    return () => media.removeEventListener('change', closeOnDesktop);
  }, []);

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
    return () => document.body.classList.remove('nav-lock');
  }, [navOpen, searchOpen]);

  useEffect(() => {
    if (!navOpen || searchOpen) return;
    sidebarRef.current?.querySelector<HTMLElement>('a, button, select')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setNavOpen(false); }
      if (event.key !== 'Tab') return;
      const controls = sidebarRef.current?.querySelectorAll<HTMLElement>('a, button, select');
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      menuRef.current?.focus();
    };
  }, [navOpen, searchOpen]);

  return (
    <div className="shell">
      <a href="#doc-main" className="skip-link">
        Skip to content
      </a>

      <header className="docs-header" inert={searchOpen}>
        <Link href="/docs" className="ph-brand">
          <span className="ph-brand-mark"><BrandSymbol /></span><span className="ph-brand-name">ProxyHubb</span>{' '}<span className="ph-product-label">Docs</span>
        </Link>
        <button type="button" className="search-trigger docs-header-search" title="Search documentation" onClick={(event) => { event.currentTarget.focus(); setSearchOpen(true); }}>
          <SearchSymbol /><span>Search documentation</span><kbd aria-hidden="true">Ctrl / ⌘ K</kbd>
        </button>
        <div className="docs-header-actions">
          <a className="ph-subtle-link docs-explorer-link" href="https://explorer.proxyhubb.com">Explorer <ArrowSymbol /></a>
          <ThemeControl resolved={resolved} ready={themeReady} onChange={setTheme} />
          <a className="ph-primary-link" href="https://proxyhubb.com/app">Open workspace <ArrowSymbol /></a>
        </div>
      </header>

      <header className="mobile-bar">
        <button
          ref={menuRef}
          type="button"
          className="icon-btn"
          aria-label={navOpen ? 'Close' : 'Menu'}
          aria-expanded={navOpen}
          aria-controls="docs-sidebar"
          onClick={() => setNavOpen((v) => !v)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d={navOpen ? 'm6 6 12 12M6 18 18 6' : 'M4 6h16M4 12h16M4 18h16'} /></svg>
        </button>
        <Link href="/docs" className="ph-brand">
          <span className="ph-brand-mark"><BrandSymbol /></span><span className="ph-brand-name">ProxyHubb</span>{' '}<span className="ph-product-label">Docs</span>
        </Link>
        <ThemeControl resolved={resolved} ready={themeReady} onChange={setTheme} />
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
        ref={sidebarRef}
        id="docs-sidebar"
        className={`docs-sidebar${navOpen ? ' open' : ''}`}
        aria-label="Docs navigation"
        role={navOpen ? 'dialog' : undefined}
        aria-modal={navOpen && !searchOpen ? true : undefined}
        inert={searchOpen}
      >
        <button type="button" className="docs-nav-close" onClick={() => setNavOpen(false)}>Close navigation</button>
        <div className="brand-block">
          <Link href="/docs" className="ph-brand">
            <span className="ph-brand-mark"><BrandSymbol /></span><span className="ph-brand-name">ProxyHubb</span>{' '}<span className="ph-product-label">Docs</span>
          </Link>
          <p className="brand-tag">Guides & API reference</p>
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
        <div className="docs-sidebar-footer">
          <a href="https://explorer.proxyhubb.com">Explore the network <ArrowSymbol /></a>
          <a href="https://proxyhubb.com/app">Open workspace <ArrowSymbol /></a>
          <button type="button" onClick={() => setTheme('system')} aria-pressed={theme === 'system'}>Use device appearance</button>
        </div>
      </aside>

      <main id="doc-main" className="main" tabIndex={-1} inert={navOpen || searchOpen}>
        {children}
      </main>

      <nav className="mobile-dock" aria-label="Quick actions">
        <button
          type="button"
          className="dock-btn"
          onClick={(event) => { event.currentTarget.focus(); setSearchOpen(true); }}
          aria-label="Search documentation"
        >
          Search
        </button>
        <Link href="/docs/api" className="dock-btn">API reference</Link>
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
