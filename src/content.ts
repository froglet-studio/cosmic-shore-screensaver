/**
 * Where exported content comes from. A normal build fetches it from `content/` next to the page.
 * A single-file build (tools/build_single.mjs) embeds it as base64 in `window.__CONTENT`, so the
 * page needs no second request: that is the shape the Windows and macOS hosts can use too.
 */
declare global {
  interface Window { __CONTENT?: Record<string, string> }
}

const BASE = `${import.meta.env.BASE_URL}content/`;

export async function loadBytes(name: string): Promise<ArrayBuffer> {
  const embedded = window.__CONTENT?.[name];
  if (embedded !== undefined) {
    const bin = atob(embedded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  const r = await fetch(BASE + name);
  if (!r.ok) throw new Error(`could not load ${name}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

export async function loadJson<T>(name: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await loadBytes(name))) as T;
}
