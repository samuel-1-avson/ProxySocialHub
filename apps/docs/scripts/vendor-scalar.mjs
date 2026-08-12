/**
 * Pin + self-host Scalar API Reference browser build under public/vendor/
 * so /docs/api does not depend on a live jsDelivr CDN at runtime.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = process.env.SCALAR_VERSION || '1.28.1';
const OUT_DIR = path.resolve(__dirname, '../public/vendor');
const OUT = path.join(OUT_DIR, 'scalar-api-reference.js');
const META = path.join(OUT_DIR, 'scalar-version.json');
const URL = `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${VERSION}/dist/browser/standalone.js`;

fs.mkdirSync(OUT_DIR, { recursive: true });

const existingMeta = fs.existsSync(META)
  ? JSON.parse(fs.readFileSync(META, 'utf8'))
  : null;
if (existingMeta?.version === VERSION && fs.existsSync(OUT) && fs.statSync(OUT).size > 1000) {
  console.log(`[docs] Scalar vendor OK @${VERSION}`);
  process.exit(0);
}

console.log(`[docs] fetching Scalar @${VERSION}…`);
const res = await fetch(URL);
if (!res.ok) {
  if (fs.existsSync(OUT)) {
    console.warn(`[docs] fetch failed (${res.status}); keeping existing vendor bundle`);
    process.exit(0);
  }
  console.error(`[docs] failed to download Scalar: HTTP ${res.status}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
fs.writeFileSync(OUT, buf);
fs.writeFileSync(META, JSON.stringify({ version: VERSION, url: URL, bytes: buf.length }, null, 2));
console.log(`[docs] wrote public/vendor/scalar-api-reference.js (${buf.length} bytes)`);
