import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { outDir: 'dist', emptyOutDir: true },
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { proxy: { '/v1': 'http://127.0.0.1:3005', '/v3': 'http://127.0.0.1:3005' } },
});
