// 同一個 Worker 提供 Static Assets 與 /api/*（PLAN 3.6）。wrangler.jsonc 的 run_worker_first
// 讓 /api/* 先進到這裡，其他路徑由 Static Assets 回應前端頁面。
//
// Key 的安全邊界（PLAN 3.2）：
// - key 只從 Authorization header 讀取，只轉送到 OpenAI 的 Authorization header。
// - 不以 console 記錄請求 header、body 或 OpenAI 的回應內容；Workers Logs 開啟，任何 console 輸出都會被保存。
// - 錯誤回應只含本 app 的錯誤類別（StoryApiErrorCode／CoverApiErrorCode／SpeechApiErrorCode），不含 OpenAI 的錯誤訊息原文。
// - Worker 不保存任何請求資料，每個請求彼此獨立，不同使用者拿不到彼此的故事（A9）。
import { STORY_API_PATH, WORKER_TEXT_TIMEOUT_MS, type StoryApiErrorCode } from '../shared/storyApi'
import { COVER_API_PATH, WORKER_COVER_TIMEOUT_MS, type CoverApiErrorCode } from '../shared/coverApi'
import { isLoopbackHost } from '../shared/loopback'
import { SPEECH_API_PATH, WORKER_SPEECH_TIMEOUT_MS, type SpeechApiErrorCode } from '../shared/speechApi'
import { checkApiKey, validateStoryInput, type StoryInputField } from '../shared/storyInput'
import { buildCoverRequest, mapCoverError, OPENAI_IMAGES_URL, parseCoverStory } from './cover'
import { buildSpeechRequest, mapSpeechError, OPENAI_SPEECH_URL, parseSpeechBody } from './speech'
import { buildStoryTextRequest, mapOpenAIError, OPENAI_RESPONSES_URL, parseStoryTextResponse } from './storyText'

export interface WorkerDeps {
  /** 呼叫 OpenAI 用的 fetch；測試注入假回應，日常測試不連網。 */
  fetch: typeof fetch
  /** 產生逾時用的 AbortSignal；測試注入可手動觸發的 signal，不以真實等待驗證逾時。 */
  timeoutSignal: (ms: number) => AbortSignal
}

type ApiErrorCode = StoryApiErrorCode | CoverApiErrorCode | SpeechApiErrorCode

const ERROR_STATUS: Record<ApiErrorCode, number> = {
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
  cover_refused: 502,
  invalid_cover: 502,
  invalid_audio: 502,
}

/** API 回應含使用者的故事需求與生成結果，一律 no-store，不讓瀏覽器或中間層快取。 */
function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

function errorResponse(error: ApiErrorCode, fields?: StoryInputField[]): Response {
  // fields 只有故事文字 API 的 invalid_input 會帶（StoryErrorBody）；封面與語音 API 的錯誤只有 error。
  const body = fields ? { error, fields } : { error }
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

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

/**
 * 單張封面（PLAN 3.3、3.7）。與故事文字相同只呼叫 OpenAI 一次、不自動重試，失敗由使用者手動重試封面。
 *
 * 成功回應不在 Worker 內解析或解碼，直接把 OpenAI 的 body 串流給瀏覽器：base64 圖片 JSON 體積大，
 * 解析可能超過 Free 方案每請求 10 ms 的 CPU 時間。只轉送 body，不轉送 OpenAI 的回應 header。
 * 逾時 signal 在回應 header 送出後仍作用在 body 串流上：逾時就中斷串流，瀏覽器讀 body 失敗而結束為失敗。
 */
async function handleCover(request: Request, deps: WorkerDeps): Promise<Response> {
  if (request.method !== 'POST') return errorResponse('method_not_allowed')

  const apiKey = readKey(request)
  const story = parseCoverStory(await readJson(request))
  if (!story || checkApiKey(apiKey)) return errorResponse('invalid_input')

  const signal = deps.timeoutSignal(WORKER_COVER_TIMEOUT_MS)
  try {
    const res = await deps.fetch(OPENAI_IMAGES_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildCoverRequest(story)),
      signal,
    })
    if (!res.ok) {
      const errorBody: unknown = await res.json().catch(() => null)
      return errorResponse(mapCoverError(res.status, errorBody))
    }
    if (!res.body) return errorResponse('upstream_error')
    return new Response(res.body, {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  } catch (error) {
    return errorResponse(isTimeout(error, signal) ? 'timeout' : 'network_error')
  }
}

/**
 * 單句 OpenAI 語音（PLAN 3.8）。與封面相同只呼叫 OpenAI 一次、不自動重試，失敗由使用者手動重試該句。
 *
 * 成功回應直接把 OpenAI 的 mp3 串流給瀏覽器，不在 Worker 內讀完：省下 Worker 的 CPU 與記憶體，
 * 也不轉送 OpenAI 的回應 header。逾時 signal 在回應 header 送出後仍作用在 body 串流上，逾時就中斷串流。
 */
async function handleSpeech(request: Request, deps: WorkerDeps): Promise<Response> {
  if (request.method !== 'POST') return errorResponse('method_not_allowed')

  const apiKey = readKey(request)
  const input = parseSpeechBody(await readJson(request))
  if (!input || checkApiKey(apiKey)) return errorResponse('invalid_input')

  const signal = deps.timeoutSignal(WORKER_SPEECH_TIMEOUT_MS)
  try {
    const res = await deps.fetch(OPENAI_SPEECH_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildSpeechRequest(input)),
      signal,
    })
    if (!res.ok) {
      const errorBody: unknown = await res.json().catch(() => null)
      return errorResponse(mapSpeechError(res.status, errorBody))
    }
    if (!res.body) return errorResponse('upstream_error')
    return new Response(res.body, {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' },
    })
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
      if (url.pathname === COVER_API_PATH) return handleCover(request, deps)
      if (url.pathname === SPEECH_API_PATH) return handleSpeech(request, deps)
      // 其他 /api 路徑一律回 404 JSON，避免前端把 index.html 當成 API 回應解析。
      return errorResponse('not_found')
    },
  } satisfies ExportedHandler<Env>
}

// Workers 的全域 fetch 不能脫離原本的 this 呼叫，因此包一層而不是直接傳 fetch。
export default createWorker({
  fetch: (input, init) => fetch(input, init),
  timeoutSignal: (ms) => AbortSignal.timeout(ms),
})
