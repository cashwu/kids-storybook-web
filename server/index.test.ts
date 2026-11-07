import { describe, expect, it } from 'vitest'
import worker from './index'

// 這裡直接呼叫 fetch handler，不經過 workerd；只能證明 handler 本身的回應，
// 不能證明 wrangler 設定的 run_worker_first 路由，該部分由本機 wrangler dev 與試驗部署確認。
describe('Worker /api 路由', () => {
  it('尚未定義的 /api 路徑回 404 JSON，不回前端頁面', async () => {
    const res = await worker.fetch(new Request('https://example.test/api/unknown'))

    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: 'not_found' })
  })
})
