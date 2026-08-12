import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const CONTENT_DIR = path.join(process.cwd(), 'content');

export type DocMeta = {
  slug: string[];
  title: string;
  description?: string;
  full?: boolean;
};

export type DocPage = DocMeta & {
  body: string;
};

function walk(dir: string, prefix: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full, [...prefix, entry.name]));
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
      const base = entry.name.replace(/\.mdx?$/, '');
      const slug = base === 'index' ? prefix : [...prefix, base];
      files.push(slug.join('/') || 'index');
    }
  }
  return files;
}

export function listDocSlugs(): string[][] {
  return walk(CONTENT_DIR).map((s) => (s === 'index' ? [] : s.split('/')));
}

function resolveFile(slug: string[]): string | null {
  const rel = slug.length === 0 ? 'index' : slug.join('/');
  for (const ext of ['.mdx', '.md']) {
    const candidates = [
      path.join(CONTENT_DIR, rel + ext),
      path.join(CONTENT_DIR, rel, 'index' + ext),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }
  return null;
}

export function getDoc(slug: string[]): DocPage | null {
  const file = resolveFile(slug);
  if (!file) return null;
  const raw = fs.readFileSync(file, 'utf8');
  const { data, content } = matter(raw);
  return {
    slug,
    title: String(data.title || slug[slug.length - 1] || 'Docs'),
    description: data.description ? String(data.description) : undefined,
    full: Boolean(data.full),
    body: content,
  };
}

export { NAV, SEARCH_INDEX } from './nav';

/** Drop leading ATX H1 so the shell title is not duplicated. */
export function stripLeadingH1(body: string): string {
  return body.replace(/^#\s+[^\n]+\n+/, '');
}
