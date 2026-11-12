// Build ONE self-contained HTML file: the bundle's JS inlined and every exported content file
// embedded as base64. It is the shareable preview page (published as a claude.ai artifact),
// and the same shape a native host can load with no file server.
//   npm run build && node tools/build_single.mjs          ->  dist-single/cosmic-shore-screensaver.html
//   npm run build && node tools/build_single.mjs --host   ->  dist-single/screensaver-host.html
// --host is the page the native hosts embed (host/windows): a full document with no preview buttons
// and no loading text, and a CSP that allows nothing but the page itself.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const content = fileURLToPath(new URL('../public/content/', import.meta.url));
const html = await readFile(join(dist, 'index.html'), 'utf8');
const src = html.match(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/);
if (!src) throw new Error('could not find the bundle script in dist/index.html');
const js = (await readFile(join(dist, src[1]), 'utf8')).replace(/<\/script/gi, '<\\/script');

const embed = {};
for (const f of await readdir(content)) {
  if (f.endsWith('.md')) continue;
  embed[f] = (await readFile(join(content, f))).toString('base64');
}

const preview = `<title>Cosmic Shore Screensaver</title>
<meta name="description" content="Live preview of the Cosmic Shore screensaver.">
<style>
  :root { --bg: #020108; --fg: #c9d4ee; --muted: #8fa3c8; --btn: rgba(12, 18, 40, .72); --btn-edge: rgba(120, 150, 220, .35); color-scheme: dark; }
  html, body { height: 100%; margin: 0; background: var(--bg); color: var(--fg); overflow: hidden; }
  canvas { position: fixed; inset: 0; display: block; width: 100%; height: 100%; }
  #hud { position: fixed; left: calc(12px + env(safe-area-inset-left, 0px)); bottom: calc(10px + env(safe-area-inset-bottom, 0px));
         font: 12px/1.4 system-ui, sans-serif; color: var(--muted); opacity: .7; pointer-events: none; }
  #controls { position: fixed; right: calc(12px + env(safe-area-inset-right, 0px)); bottom: calc(12px + env(safe-area-inset-bottom, 0px));
              display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
  #controls button, #controls select { font: 500 13px/1 system-ui, sans-serif; color: var(--fg); background: var(--btn); border: 1px solid var(--btn-edge);
                     border-radius: 6px; padding: 9px 12px; cursor: pointer; backdrop-filter: blur(6px); }
  #controls select { padding: 8px 10px; max-width: 60vw; }
  #controls select option { background: #0c1228; color: var(--fg); }
  #controls button:hover, #controls select:hover { border-color: var(--fg); }
  #controls button:focus-visible, #controls select:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
  #loading { position: fixed; inset: 0; display: grid; place-items: center; font: 14px system-ui, sans-serif; color: var(--muted); pointer-events: none; }
</style>
<div id="loading">Loading the Garland…</div>
<div id="hud"></div>
<script>window.__PREVIEW = true; window.__CONTENT = ${JSON.stringify(embed)};</script>
<script type="module">${js}
document.getElementById('loading')?.remove();</script>
`;
const host = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src data: blob:; worker-src blob:">
<title>Cosmic Shore Screensaver</title>
<style>
  html, body { height: 100%; margin: 0; background: #020108; overflow: hidden; cursor: none; }
  canvas { position: fixed; inset: 0; display: block; width: 100%; height: 100%; }
  #hud { position: fixed; left: 12px; bottom: 10px; font: 12px/1.4 system-ui, sans-serif; color: #8fa3c8; opacity: .6; pointer-events: none; }
</style>
</head>
<body>
<div id="hud"></div>
<script>window.__CONTENT = ${JSON.stringify(embed)};</script>
<script type="module">${js}</script>
</body>
</html>
`;

const hostMode = process.argv.includes('--host');
const [name, page] = hostMode ? ['screensaver-host.html', host] : ['cosmic-shore-screensaver.html', preview];
await mkdir('dist-single', { recursive: true });
await writeFile(`dist-single/${name}`, page);
console.log(`wrote dist-single/${name} (${(page.length / 1e6).toFixed(2)} MB)`);
