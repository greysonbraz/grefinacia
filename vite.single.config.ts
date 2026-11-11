import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Gera um único arquivo HTML com tudo embutido (para abrir direto no navegador).
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  publicDir: false,
  build: { target: 'es2020', outDir: 'dist-html', assetsInlineLimit: 100000000, chunkSizeWarningLimit: 5000 },
});
