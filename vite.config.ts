import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // Pre-bundle lazily imported libraries so the dev server doesn't reload mid-session.
  optimizeDeps: {
    include: ['hucre/xlsx', 'hucre/ods', 'yaml', 'fast-xml-parser', 'diff', 'html-to-image'],
  },
  preview: { host: '127.0.0.1', port: 3100, allowedHosts: ['jsonp.bjk.ai'] },
});
