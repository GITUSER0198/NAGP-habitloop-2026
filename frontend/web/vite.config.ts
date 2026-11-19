import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('../../', import.meta.url)), '');
  return {
    plugins: [
      {
        name: 'habitloop-stencil-entry-chunks',
        enforce: 'pre',
        transform(code, id) {
          if (!id.replaceAll('\\', '/').includes('/components/dist/esm/index-')) return;
          // Stencil's variable import must be visible to Vite to emit its entry chunks.
          return code.replace('/* @vite-ignore */', '').replace(
            '`./${bundleId}.entry.js${cacheBustParams ? "?" + cacheBustParams : ""}`',
            '`./${bundleId}.entry.js`'
          );
        }
      },
      sveltekit()
    ],
    optimizeDeps: { exclude: ['@habitloop/components'] },
    server: { port: Number(env.WEB_PORT), strictPort: true },
    preview: { port: Number(env.WEB_PORT), strictPort: true }
  };
});
