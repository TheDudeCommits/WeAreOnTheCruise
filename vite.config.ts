import { readdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Every lab/<name>.html page (one per module agent) ships with the build so labs can be reviewed on Vercel.
const labDir = resolve(__dirname, 'lab');
const labs = existsSync(labDir)
  ? Object.fromEntries(readdirSync(labDir).filter((f) => f.endsWith('.html')).map((f) => [`lab-${f.replace(/\.html$/, '')}`, resolve(labDir, f)]))
  : {};

export default defineConfig({
  server: { port: 4173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), ...labs } },
  },
});
