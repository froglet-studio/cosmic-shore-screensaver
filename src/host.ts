/**
 * The page's side of the native hosts. Both load the page with `?host=<name>&mode=s|p|w`:
 * - the Windows .scr (host/windows) as `host=scr`, inside a WebView2 that exposes `window.chrome.webview`;
 * - the macOS .saver (host/macos) as `host=saver`, inside a WKWebView that exposes
 *   `window.webkit.messageHandlers.host`.
 * In every host mode the mouse pointer is hidden.
 * In full-screen mode (`s`) any key, click, wheel or touch the page sees is sent to the host as "exit".
 * The Windows host also watches raw input itself, so this is the second of two ways out; on the Mac the
 * system ends the screensaver on input, and the host ignores "exit" there.
 * "ready" tells the host the scene is up; "error:..." passes a page error to the host's log.
 */
type HostBridge = { postMessage(message: string): void };

function findBridge(): HostBridge | undefined {
  const w = window as unknown as {
    chrome?: { webview?: HostBridge };
    webkit?: { messageHandlers?: { host?: HostBridge } };
  };
  if (w.chrome?.webview) return w.chrome.webview;
  const mac = w.webkit?.messageHandlers?.host;
  return mac ? { postMessage: (m) => mac.postMessage(m) } : undefined;
}

const HOSTS = new Set(['scr', 'saver']);
let bridge: HostBridge | undefined;

export function attachHost(params: URLSearchParams): void {
  if (!HOSTS.has(params.get('host') ?? '')) return;
  document.documentElement.style.cursor = 'none';
  bridge = findBridge();
  if (!bridge) return;
  const b = bridge;
  addEventListener('error', (e) => b.postMessage(`error: ${e.message}`));
  addEventListener('unhandledrejection', (e) => b.postMessage(`error: ${String(e.reason)}`));
  if (params.get('mode') !== 's') return;
  const exit = () => b.postMessage('exit');
  for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const) {
    addEventListener(type, exit, { passive: true });
  }
}

export function hostReady(): void {
  bridge?.postMessage('ready');
}
