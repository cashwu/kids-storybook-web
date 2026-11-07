import { defineConfig } from 'vitest/config'

// 日常測試只在 Node 中呼叫 handler 與注入的假 fetch，不啟動 workerd、不連網。
export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
})
