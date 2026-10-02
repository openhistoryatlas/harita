// Watch content, src and geo; rebuild on change; serve dist/ with a reload hook for open tabs.
import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json' };
const RELOAD = `<script>(()=>{let v=null;setInterval(async()=>{try{const r=await fetch('/__version');const t=await r.text();if(v===null)v=t;else if(t!==v)location.reload();}catch{}},1000)})()</script>`;

// Serve root/dist on the port and rebuild it when root/content, root/geo or this package's src changes.
// Returns the http server. Each build runs in a child process, so edits to the package itself take effect too.
export function dev({ root = process.cwd(), port = Number(process.env.PORT) || 8080, log = console.log } = {}) {
  const DIST = path.join(root, 'dist');
  const WATCH = [path.join(root, 'content'), path.join(root, 'geo'), path.join(PKG, 'src')].filter(fs.existsSync);

  let version = 0, building = false, queued = false;
  function build() {
    if (building) { queued = true; return; }
    building = true;
    const t0 = Date.now();
    const p = spawn(process.execPath, [path.join(PKG, 'bin', 'harita.mjs'), 'build'], { stdio: 'inherit', cwd: root });
    p.on('exit', code => {
      building = false;
      if (code === 0) { version = Date.now(); log(`build ok in ${Date.now() - t0} ms, tabs reload`); }
      else log('build failed, fix the error above and save again');
      if (queued) { queued = false; build(); }
    });
  }

  let timer = null;
  for (const dir of WATCH) {
    fs.watch(dir, { recursive: true }, (_, file) => {
      if (file && /(^|\/)\./.test(file)) return; // editor swap files and the like
      clearTimeout(timer); timer = setTimeout(build, 150);
    });
  }

  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/__version') { res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); return res.end(String(version)); }
    if (url === '/' && !fs.existsSync(path.join(DIST, 'index.html'))) {
      const stories = fs.existsSync(DIST) ? fs.readdirSync(DIST).filter(d => fs.existsSync(path.join(DIST, d, 'index.html'))) : [];
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><meta charset="utf-8"><title>Stories</title><h1>Stories</h1><ul>${stories.map(s => `<li><a href="/${s}/">${s}</a></li>`).join('')}</ul>${RELOAD}`);
    }
    let file = path.join(DIST, url.endsWith('/') ? url + 'index.html' : url);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file);
    res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    if (ext === '.html') return res.end(fs.readFileSync(file, 'utf8').replace('</body>', RELOAD + '</body>'));
    fs.createReadStream(file).pipe(res);
  });
  server.listen(port, () => {
    log(`serving dist/ at http://localhost:${port}/ and watching ${WATCH.map(d => path.basename(d)).join(', ')}`);
    build();
  });
  return server;
}
