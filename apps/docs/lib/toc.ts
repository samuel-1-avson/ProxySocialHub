import { slugify } from './slug';

export type TocItem = {
  id: string;
  text: string;
  level: 2 | 3;
};

/** Extract H2/H3 headings from markdown body (after frontmatter stripped). */
export function extractToc(body: string): TocItem[] {
  const items: TocItem[] = [];
  const seen = new Map<string, number>();
  for (const line of body.split('\n')) {
    const m = /^(#{2,3})\s+(.+?)\s*#*$/.exec(line);
    if (!m) continue;
    // skip fenced code false-positives loosely: headings rarely inside code in our docs
    const level = m[1].length as 2 | 3;
    const text = m[2].replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    let id = slugify(text);
    const n = (seen.get(id) || 0) + 1;
    seen.set(id, n);
    if (n > 1) id = `${id}-${n}`;
    items.push({ id, text, level });
  }
  return items;
}
