import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileMDX } from 'next-mdx-remote/rsc';

test('MDX keeps documented components, string attributes, and fenced examples', async () => {
  const { content } = await compileMDX({
    source: '# Wallet setup\n\n<Callout title="Devnet">Use test SOL.</Callout>\n\n```js\nprocess.env.EXAMPLE\n```',
    components: {
      Callout: ({ title, children }) => createElement('aside', null, title, children),
    },
  });
  const html = renderToStaticMarkup(content);
  assert.match(html, /<h1>Wallet setup<\/h1>/);
  assert.match(html, /<aside>Devnet.*Use test SOL\./);
  assert.match(html, /<code class="language-js">process.env.EXAMPLE/);
});

test('MDX expressions and JSX attribute expressions cannot execute JavaScript', async () => {
  const sentinel = '__proxyhubbMdxExecuted';
  globalThis[sentinel] = false;
  try {
    const { content } = await compileMDX({
      source: `Safe text\n\n{globalThis.${sentinel} = true}\n\n<Callout title={globalThis.${sentinel} = true}>Still safe</Callout>`,
      components: {
        Callout: ({ title, children }) => createElement('aside', { 'data-title': title }, children),
      },
    });
    const html = renderToStaticMarkup(content);
    assert.equal(globalThis[sentinel], false);
    assert.match(html, /Safe text/);
    assert.match(html, /Still safe/);
    assert.doesNotMatch(html, /data-title|globalThis/);
  } finally {
    delete globalThis[sentinel];
  }
});
