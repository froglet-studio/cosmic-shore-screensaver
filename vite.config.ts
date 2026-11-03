import { defineConfig } from 'vite';

// base './' so the same build runs from any folder: the landing page, a WebView2 virtual host,
// or a WKWebView loading the .saver's Resources.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1024,
  },
});
