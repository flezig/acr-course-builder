import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Разбор запроса моделью выполняет сервер CourseOS (courseos/backend); в разработке он слушает 8000.
    proxy: { '/api/llm': process.env.COURSEOS_BACKEND_URL ?? 'http://127.0.0.1:8000' },
  },
});
