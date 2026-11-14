/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { buildCsp } from './src/lib/csp.ts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Coloca a Content-Security-Policy no index.html do app compilado.
 * Só no build: o servidor de desenvolvimento do Vite precisa de scripts embutidos para o recarregamento automático.
 */
function cspPlugin(): Plugin {
  return {
    name: 'grefinacia-csp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: buildCsp() }, injectTo: 'head-prepend' }],
  };
}

export default defineConfig({
  plugins: [react(), cspPlugin()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify((process.env.GITHUB_SHA ?? '').slice(0, 7) || 'local'),
  },
  build: { target: 'es2020', outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { host: true, port: 5173 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
});
