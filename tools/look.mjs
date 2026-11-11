// Look at the scene over time: like smoke.mjs, but takes SHOTS screenshots EVERY ms per view.
//   npm run build && VIEWS=lavalamp SHOTS=3 EVERY=15000 EXTRA='&arrow' node tools/look.mjs
// Writes smoke-out/look-<view>-<n>.png. Debug params for EXTRA: &arrow (heading arrow), &side (top-down chase), &seed=N.
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
for (const view of (process.env.VIEWS ?? "lavalamp,vessel").split(",")) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${view}] console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${view}] page error: ${e.message}`));
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.push(`[${view}] external request: ${r.url()}`); });
  await page.goto(`${origin}/?view=${view}&debug${process.env.EXTRA ?? ""}`);
  try {
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    for (let k = 0; k < Number(process.env.SHOTS ?? 4); k++) {
      await page.waitForTimeout(Number(process.env.EVERY ?? 8000));
      await page.screenshot({ path: `smoke-out/look-${view}-${k}.png`, timeout: 120000 });
      console.log(`${view} ${k}: ${await page.textContent('#hud')}`);
    }
  } catch (e) { problems.push(`[${view}] never ready: ${e.message}`); }
  await page.close();
}
await browser.close();
server.close();
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('smoke OK');
