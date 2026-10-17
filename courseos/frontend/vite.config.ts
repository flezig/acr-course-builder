import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  // Демо на ВМ хакатона открывается через публичный домен прокси, поэтому проверку Host отключаем.
  preview: { allowedHosts: true },
});
