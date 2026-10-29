/**
 * Build public/search-index.json from content/*.mdx for client full-text search.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(__dirname, '../content');
const OUT = path.resolve(__dirname, '../public/search-index.json');

function walk(dir, prefix = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full, [...prefix, entry.name]));
    } else if (/\.mdx?$/.test(entry.name)) {
      const base = entry.name.replace(/\.mdx?$/, '');
      const slug = base === 'index' ? prefix : [...prefix, base];
      files.push({ file: full, slug });
    }
  }
  return files;
}

function toPlain(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[*_~>#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sectionFor(slug) {
  if (slug.length === 0) return 'Overview';
  const root = slug[0];
  const map = {
    quickstart: 'Quickstarts',
    concepts: 'Concepts',
    architecture: 'Architecture',
    wallet: 'Wallet',
    buyer: 'Buyer',
    sdks: 'SDKs',
    api: 'API',
    marketplace: 'Marketplace',
    provider: 'Provider',
    troubleshooting: 'Guides',
    changelog: 'Changelog',
    'getting-started': 'Overview',
  };
  return map[root] || 'Docs';
}

const docs = walk(CONTENT_DIR).map(({ file, slug }) => {
  const raw = fs.readFileSync(file, 'utf8');
  // Match the page loader, including CRLF files and quoted YAML metadata.
  const { data, content: body } = matter(raw);
  const href = '/docs' + (slug.length ? `/${slug.join('/')}` : '');
  const title = data.title || slug[slug.length - 1] || 'Documentation';
  const description = data.description || '';
  const text = toPlain(body).slice(0, 12000);
  return {
    href,
    title,
    description,
    section: sectionFor(slug),
    text,
  };
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(docs));
console.log(`[docs] search index → ${docs.length} pages`);
