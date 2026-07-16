import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // Dev-only: this folder ("split 2.0") has a space in its name, so some
      // tooling launches the dev server through the Windows 8.3 short alias
      // (SPLIT2~1.0). Vite realpath-resolves its allow-list but not incoming
      // request ids, so short-alias requests can never match an allow entry —
      // the only workable option is disabling the strict check. Affects the
      // localhost dev server only; production builds don't use this server.
      strict: false,
    },
  },
});
