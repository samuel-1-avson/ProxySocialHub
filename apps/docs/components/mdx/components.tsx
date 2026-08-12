import type { MDXComponents } from 'mdx/types';
import type { ReactNode } from 'react';
import { CodeBlock } from '@/components/code-block';
import { extractText, slugify } from '@/lib/slug';
import { Callout } from './callout';
import { Step, Steps } from './steps';

function heading(level: 2 | 3) {
  const Tag = `h${level}` as 'h2' | 'h3';
  return function Heading({ children }: { children?: ReactNode }) {
    const text = extractText(children);
    const id = slugify(text);
    return (
      <Tag id={id}>
        <a href={`#${id}`} className="heading-anchor">
          {children}
        </a>
      </Tag>
    );
  };
}

export const mdxComponents: MDXComponents = {
  Callout,
  Steps,
  Step,
  h2: heading(2),
  h3: heading(3),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
};
