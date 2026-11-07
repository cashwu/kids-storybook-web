import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { cloudflare } from '@cloudflare/vite-plugin'

// cloudflare() 讓 `vite dev` 在 workerd 中執行 server/index.ts，並在 build 時同時產出
// 前端 Static Assets 與 Worker，維持「同一個 Worker、同網域」的部署形態（PLAN 3.6）。
export default defineConfig({
  plugins: [vue(), cloudflare()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
