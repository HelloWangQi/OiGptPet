import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

export default defineConfig(({ command, mode }) => ({
  base: './',
  // Demo assets are opt-in for development and isolated smoke builds only.
  publicDir: command === 'serve' || mode === 'test-demo' ? 'public' : false,
  define: { __WITH_DEMO__: JSON.stringify(command === 'serve' || mode === 'test-demo'), __APP_VERSION__: JSON.stringify(appVersion) },
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
  preview: { host: '0.0.0.0', port: 5173, strictPort: true },
  plugins: [{
    name: 'lan-development-websocket',
    apply: 'serve',
    transformIndexHtml(html) {
      // HMR follows the browser's LAN address; production keeps its stricter policy.
      return html.replace("connect-src 'self' blob:;", "connect-src 'self' blob: ws: wss:;");
    },
  }],
  build: {
    target: 'es2022', chunkSizeWarningLimit: 1500,
    outDir: mode === 'test-demo' ? '.cache/demo-dist' : 'dist',
    emptyOutDir: true,
  },
}));
