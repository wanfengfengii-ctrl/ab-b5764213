import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 纯前端静态站点；后端仅由 nginx 提供静态文件
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    globals: false,
  },
});
