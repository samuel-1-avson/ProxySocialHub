/**
 * Copy repo-authoritative OpenAPI into the docs public folder when available.
 * In Docker builds (apps/docs context only) the source is absent — keep existing public copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dest = path.resolve(__dirname, '../public/openapi.yaml');
const candidates = [
  path.resolve(__dirname, '../../../docs/openapi.yaml'),
  path.resolve(__dirname, '../../../../docs/openapi.yaml'),
];

const src = candidates.find((p) => fs.existsSync(p));
if (src) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`[docs] synced openapi.yaml ← ${path.relative(process.cwd(), src)}`);
} else if (fs.existsSync(dest)) {
  console.warn('[docs] OpenAPI source not found; keeping existing public/openapi.yaml');
} else {
  console.error('[docs] Missing openapi.yaml (no source and no public copy)');
  process.exit(1);
}
