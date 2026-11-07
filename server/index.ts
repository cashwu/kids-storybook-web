// 同一個 Worker 提供 Static Assets 與 /api/*（PLAN 3.6）。wrangler.jsonc 的 run_worker_first
// 讓 /api/* 先進到這裡，其他路徑由 Static Assets 回應前端頁面。
// 故事文字與封面 API 由 T2、T4 加入（朗讀在瀏覽器完成，不經過 Worker）；尚未定義的 API 一律回 404 JSON，
// 避免前端把 index.html 當成 API 回應解析。
export default {
  async fetch(_request: Request): Promise<Response> {
    return Response.json({ error: 'not_found' }, { status: 404 })
  },
} satisfies ExportedHandler<Env>
