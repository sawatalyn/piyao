import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const target = process.env.BW_API_TARGET || 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target,
        changeOrigin: false,
        cookieDomainRewrite: '127.0.0.1',
      },
    },
  },
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    // Vite 8 底层为 Rolldown：手填 manualChunks 对象已不被接受，
    // 路由级动态 import 已产生按需分块，这里交给默认策略。
  },
});
