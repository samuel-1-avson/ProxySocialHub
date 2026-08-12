import type { MDXComponents } from 'mdx/types';
import type { ReactNode } from 'react';
import { CodeBlock } from '@/components/code-block';
import { extractText, slugify } from '@/lib/slug';
import { Callout } from './callout';
import { Step, Steps } from './steps';
import { HomeStrip, PathCard, RoleGrid, StripLink } from './path-card';
import { HomeHero } from './home-hero';
import { EnvRow, EnvTable } from './env-table';
import { KbdHint } from './kbd-hint';

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

type PreProps = {
  children?: ReactNode;
  className?: string;
  'data-language'?: string;
  [key: string]: unknown;
};

function Pre(props: PreProps) {
  const { children, className, ...rest } = props;
  const fromData = typeof rest['data-language'] === 'string' ? rest['data-language'] : '';
  const fromClass =
    typeof className === 'string' ? className.match(/language-([^\s]+)/)?.[1] : undefined;
  const language = fromData || fromClass || '';
  return (
    <CodeBlock language={language}>
      <pre className={className} {...rest}>
        {children}
      </pre>
    </CodeBlock>
  );
}

export const mdxComponents: MDXComponents = {
  Callout,
  Steps,
  Step,
  PathCard,
  RoleGrid,
  HomeStrip,
  StripLink,
  HomeHero,
  EnvTable,
  EnvRow,
  KbdHint,
  h2: heading(2),
  h3: heading(3),
  pre: Pre,
};
