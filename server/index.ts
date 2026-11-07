// 同一個 Worker 提供 Static Assets 與 /api/*（PLAN 3.6）。wrangler.jsonc 的 run_worker_first
// 讓 /api/* 先進到這裡，其他路徑由 Static Assets 回應前端頁面。
//
// Key 的安全邊界（PLAN 3.2）：
// - key 只從 Authorization header 讀取，只轉送到 OpenAI 的 Authorization header。
// - 不以 console 記錄請求 header、body 或 OpenAI 的回應內容；Workers Logs 開啟，任何 console 輸出都會被保存。
// - 錯誤回應只含本 app 的錯誤類別（StoryApiErrorCode），不含 OpenAI 的錯誤訊息原文。
// - Worker 不保存任何請求資料，每個請求彼此獨立，不同使用者拿不到彼此的故事（A9）。
import { STORY_API_PATH, WORKER_TEXT_TIMEOUT_MS, type StoryApiErrorCode, type StoryErrorBody } from '../shared/storyApi'
import { isLoopbackHost } from '../shared/loopback'
import { validateStoryInput, type StoryInputField } from '../shared/storyInput'
import { buildStoryTextRequest, mapOpenAIError, OPENAI_RESPONSES_URL, parseStoryTextResponse } from './storyText'

export interface WorkerDeps {
  /** 呼叫 OpenAI 用的 fetch；測試注入假回應，日常測試不連網。 */
  fetch: typeof fetch
  /** 產生逾時用的 AbortSignal；測試注入可手動觸發的 signal，不以真實等待驗證逾時。 */
  timeoutSignal: (ms: number) => AbortSignal
}

const ERROR_STATUS: Record<StoryApiErrorCode, number> = {
  invalid_input: 400,
  insecure_request: 403,
  not_found: 404,
  method_not_allowed: 405,
  invalid_key: 401,
  permission_denied: 403,
  rate_limited: 429,
  insufficient_quota: 429,
  timeout: 504,
  network_error: 502,
  upstream_error: 502,
  story_refused: 502,
  invalid_story: 502,
}

/** API 回應含使用者的故事需求與生成結果，一律 no-store，不讓瀏覽器或中間層快取。 */
function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

function errorResponse(error: StoryApiErrorCode, fields?: StoryInputField[]): Response {
  const body: StoryErrorBody = fields ? { error, fields } : { error }
  return json(body, ERROR_STATUS[error])
}

/**
 * workers.dev 的 http 網址不會自動轉 https，key 會以明文經過網路，因此在讀取 key 前就拒絕（PLAN 3.2）。
 * 本機 loopback 例外見 isLoopbackHost。
 */
function isSecure(url: URL): boolean {
  return url.protocol === 'https:' || isLoopbackHost(url.hostname)
}

function readKey(request: Request): string {
  const header = request.headers.get('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
}

interface StoryBody {
  character: string
  situation: string
  pageCount: number
}

/** 型別不符的欄位換成必定驗證失敗的值，交給 validateStoryInput 統一指出欄位。 */
async function readBody(request: Request): Promise<StoryBody | null> {
  try {
    const body: unknown = await request.json()
    if (typeof body !== 'object' || body === null) return null
    const { character, situation, pageCount } = body as Record<string, unknown>
    return {
      character: typeof character === 'string' ? character : '',
      situation: typeof situation === 'string' ? situation : '',
      pageCount: typeof pageCount === 'number' ? pageCount : Number.NaN,
    }
  } catch {
    return null
  }
}

function isTimeout(error: unknown, signal: AbortSignal): boolean {
  const reason: unknown = signal.aborted ? signal.reason : error
  return reason instanceof Error && reason.name === 'TimeoutError'
}

async function handleStory(request: Request, env: Env, deps: WorkerDeps): Promise<Response> {
  if (request.method !== 'POST') return errorResponse('method_not_allowed')

  const body = (await readBody(request)) ?? { character: '', situation: '', pageCount: Number.NaN }
  const checked = validateStoryInput({ ...body, apiKey: readKey(request) })
  if (!checked.ok) return errorResponse('invalid_input', Object.keys(checked.errors) as StoryInputField[])
  const { apiKey, ...input } = checked.value

  // 只呼叫一次，不自動重試：每次呼叫都由使用者的 key 計費，失敗只由使用者手動重試（PLAN 3.3）。
  // signal 同時涵蓋等待回應與讀取 body，確保請求一定在時限內結束為成功或失敗。
  const signal = deps.timeoutSignal(WORKER_TEXT_TIMEOUT_MS)
  try {
    const res = await deps.fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildStoryTextRequest(input, env)),
      signal,
    })
    if (!res.ok) {
      const errorBody: unknown = await res.json().catch(() => null)
      return errorResponse(mapOpenAIError(res.status, errorBody))
    }
    let responseBody: unknown
    try {
      responseBody = await res.json()
    } catch (error) {
      if (isTimeout(error, signal)) throw error
      return errorResponse('upstream_error')
    }
    const result = parseStoryTextResponse(responseBody, input.pageCount)
    return result.ok ? json({ story: result.story }) : errorResponse(result.error)
  } catch (error) {
    return errorResponse(isTimeout(error, signal) ? 'timeout' : 'network_error')
  }
}

export function createWorker(deps: WorkerDeps) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url)
      if (!isSecure(url)) return errorResponse('insecure_request')
      if (url.pathname === STORY_API_PATH) return handleStory(request, env, deps)
      // 尚未定義的 API（封面由 T4 加入）一律回 404 JSON，避免前端把 index.html 當成 API 回應解析。
      return errorResponse('not_found')
    },
  } satisfies ExportedHandler<Env>
}

// Workers 的全域 fetch 不能脫離原本的 this 呼叫，因此包一層而不是直接傳 fetch。
export default createWorker({
  fetch: (input, init) => fetch(input, init),
  timeoutSignal: (ms) => AbortSignal.timeout(ms),
})
