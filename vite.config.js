import { defineConfig } from 'vite';
import { cp, mkdir } from 'node:fs/promises';
export default defineConfig({ base: './', build: { outDir: 'dist', emptyOutDir: true }, plugins: [{
  name: 'math-print-assets',
  async closeBundle() {
    await mkdir('dist/katex', { recursive: true });
    await cp('node_modules/katex/dist/katex.min.css', 'dist/katex/katex.min.css');
    await cp('node_modules/katex/dist/fonts', 'dist/katex/fonts', { recursive: true });
    await cp('node_modules/mathlive/fonts', 'dist/mathlive/fonts', { recursive: true });
  },
}] });
