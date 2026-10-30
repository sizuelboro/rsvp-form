import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

// Two independent entry points:
//   index.html  → dashboard + visual editor (authenticated app)
//   public.html → lightweight public renderer for /f, /e and /i pages
/** Dev-only: mirror the Worker's routing (public pages → public.html, everything else → index.html). */
function devRouting(): Plugin {
  return {
    name: 'dev-routing',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? '/';
        const path = url.split('?')[0]!;
        if (path.startsWith('/api') || path.startsWith('/@') || path.startsWith('/src') || path.startsWith('/node_modules') || /\.[a-z0-9]+$/i.test(path)) return next();
        req.url = /^\/(f|e|i)\//.test(path) ? '/public.html' : '/index.html';
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devRouting()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: { app: resolve(__dirname, 'index.html'), public: resolve(__dirname, 'public.html') },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  appType: 'mpa',
});
