import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

const appVersion = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();
const backend = 'http://127.0.0.1:8090';

if (/^[a-z]:/.test(process.cwd())) {
  process.chdir(process.cwd().replace(/^[a-z]:/, (m) => m.toUpperCase()));
}

export default defineConfig({
  plugins: process.env.VITEST ? [svelte()] : [sveltekit()],
  resolve: {
    alias: process.env.VITEST ? { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) } : {}
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  server: {
    proxy: {
      '/api': { target: backend }
    }
  },
  test: {
    include: ['src/**/*.test.ts']
  }
});
