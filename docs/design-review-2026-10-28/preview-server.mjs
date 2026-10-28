import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const allowed = new Set(['CONCEPT.html','CONCEPT-V1.html','EXPLORER.html','concept.css','concept-v2.css','concept-base.js','concept-v2.js','theme.js','explorer.js','REPORT.md','REPORT-V2.md','route-disposition.csv','route-disposition-v2.csv','FEATURE-COVERAGE.csv','REVIEW-CHECKS.md']);
const types = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.csv':'text/csv','.md':'text/plain'};
http.createServer((req,res) => {
  const name = new URL(req.url,'http://127.0.0.1').pathname.slice(1) || 'CONCEPT.html';
  if (name === 'favicon.ico') { res.writeHead(204); res.end(); return; }
  if (!allowed.has(name) || !fs.existsSync(path.join(root,name))) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, {'Content-Type':`${types[path.extname(name)] || 'text/plain'}; charset=utf-8`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  fs.createReadStream(path.join(root,name)).pipe(res);
}).listen(4187,'127.0.0.1', () => process.stdout.write('Workspace: http://127.0.0.1:4187/CONCEPT.html\nExplorer: http://127.0.0.1:4187/EXPLORER.html\n'));
