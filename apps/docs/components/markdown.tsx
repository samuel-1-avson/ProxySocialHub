import { compileMDX } from 'next-mdx-remote/rsc';
import remarkGfm from 'remark-gfm';
import rehypePrettyCode from 'rehype-pretty-code';
import { mdxComponents } from '@/components/mdx/components';

const prettyOptions = {
  theme: {
    dark: 'github-dark-default',
    light: 'github-light-default',
  },
  keepBackground: false,
  defaultLang: 'text',
};

/**
 * Compile content/*.mdx as real MDX (supports <Callout>, <Steps>, …)
 * with GFM + Shiki via rehype-pretty-code (async-safe under compileMDX).
 */
export async function Markdown({ source }: { source: string }) {
  const { content } = await compileMDX({
    source,
    components: mdxComponents,
    options: {
      mdxOptions: {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [[rehypePrettyCode, prettyOptions]],
      },
    },
  });
  return content;
}
