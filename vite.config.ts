import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  preview: { host: '127.0.0.1', port: 3100, allowedHosts: ['jsonp.bjk.ai'] },
});
