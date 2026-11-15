import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Gera um único arquivo HTML com tudo embutido (para abrir direto no navegador).
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  publicDir: false,
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __APP_BUILD__: JSON.stringify('web') },
  build: { target: 'es2020', outDir: 'dist-html', assetsInlineLimit: 100000000, chunkSizeWarningLimit: 5000 },
});
