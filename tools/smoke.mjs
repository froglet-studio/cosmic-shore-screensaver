// Smoke test: serve the built bundle, open it in headless Chromium, and fail on a console error,
// a page error, a request that leaves the page's own origin, or a scene that never becomes ready.
// Writes screenshots to ./smoke-out/ (lavalamp and vessel views, and the wide view in a second colour set).
//   npm run build && npm run smoke
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
await mkdir('smoke-out', { recursive: true });
for (const [view, query] of [['lavalamp', ''], ['vessel', ''], ['lavalamp-dartfrog', '&colours=dartfrog']]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${view}] console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${view}] page error: ${e.message}`));
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.push(`[${view}] external request: ${r.url()}`); });
  await page.goto(`${origin}/?view=${view.split('-')[0]}&debug${query}`);
  try {
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `smoke-out/${view}.png` });
    console.log(`${view}: ${await page.textContent('#hud')}`);
  } catch (e) { problems.push(`[${view}] never ready: ${e.message}`); }
  await page.close();
}
await browser.close();
server.close();
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('smoke OK');
