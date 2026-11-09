/**
 * The page's side of the native hosts. The Windows .scr (host/windows) loads the page with
 * `?host=scr&mode=s|p|w`, inside a WebView2 that exposes `window.chrome.webview`.
 * - In every host mode the mouse pointer is hidden.
 * - In full-screen mode (`s`) any key, click, wheel or touch the page sees is sent to the host as
 *   "exit". The host also watches raw input itself, so this is the second of two ways out.
 * - "ready" tells the host the scene is up; "error:..." passes a page error to the host's log.
 */
type HostBridge = { postMessage(message: string): void };

const bridge = (window as unknown as { chrome?: { webview?: HostBridge } }).chrome?.webview;

export function attachHost(params: URLSearchParams): void {
  if (params.get('host') !== 'scr') return;
  document.documentElement.style.cursor = 'none';
  if (!bridge) return;
  addEventListener('error', (e) => bridge.postMessage(`error: ${e.message}`));
  addEventListener('unhandledrejection', (e) => bridge.postMessage(`error: ${String(e.reason)}`));
  if (params.get('mode') !== 's') return;
  const exit = () => bridge.postMessage('exit');
  for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const) {
    addEventListener(type, exit, { passive: true });
  }
}

export function hostReady(): void {
  bridge?.postMessage('ready');
}
