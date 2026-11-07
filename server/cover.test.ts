import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Story } from '../shared/story'
import { createWorker } from './index'

// POST /api/cover 的 handler 測試：直接呼叫 fetch handler 並注入假的 OpenAI fetch，不經過 workerd、不連網。
// 只能證明 handler 的回應與送給 OpenAI 的請求內容；真實模型能否產生 GIF、帳戶的 GIF 權限、
// 等待時間與 Free 方案的 CPU 用量，由 T4 真實試驗與 T5 部署驗收確認。

/** 明顯的假 key；末 4 碼 0000 對應 OpenAI 401 訊息帶回的 key 片段。 */
const KEY = 'sk-test-fake0000'
const env: Env = {}

const story: Story = {
  title: { en: "Dino's First Day", zh: '小恐龍上學去' },
  pages: [0, 1, 2, 3].map((p) => ({
    sentences: [
      { en: `Dino walks to school on page ${p + 1}.`, zh: `第 ${p + 1} 頁，小恐龍走路去上學。` },
      { en: 'He waves to Mom.', zh: '他向媽媽揮手。' },
    ],
  })),
}

/** GIF 檔頭 `GIF89a` 的 base64 開頭，代表真的是 GIF。 */
const GIF_B64 = 'R0lGODlhAQABAAAAACw='

function coverRequest(options: { url?: string; key?: string | null; body?: unknown; method?: string } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (options.key !== null) headers.set('authorization', `Bearer ${options.key ?? KEY}`)
  const method = options.method ?? 'POST'
  return new Request(options.url ?? 'https://example.test/api/cover', {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(options.body ?? { story }),
  })
}

function openAIImage(b64 = GIF_B64) {
  return Response.json(
    { created: 1, data: [{ b64_json: b64 }], usage: { output_tokens: 1172 } },
    { headers: { 'openai-organization': 'org-secret', 'x-request-id': 'req_1' } },
  )
}

function openAIError(status: number, error: { message: string; code?: string }) {
  return Response.json({ error }, { status })
}

function setup(respond: (init: RequestInit) => Response | Promise<Response> = () => openAIImage()) {
  const timeouts: Array<{ ms: number; controller: AbortController }> = []
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => respond(init ?? {}))
  const timeoutSignal = vi.fn((ms: number) => {
    const controller = new AbortController()
    timeouts.push({ ms, controller })
    return controller.signal
  })
  const handler = createWorker({ fetch: fetchMock as typeof fetch, timeoutSignal })
  return { handler, fetchMock, timeouts }
}

function sentBody(fetchMock: ReturnType<typeof setup>['fetchMock']) {
  return JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/cover 成功', () => {
  it('轉送 Images API：key 只在 Authorization，使用 PLAN 3.7 的模型、GIF、512x512 與 low', async () => {
    const { handler, fetchMock } = setup()

    await handler.fetch(coverRequest(), env)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/images/generations')
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${KEY}`)
    const body = sentBody(fetchMock)
    expect(body).toMatchObject({
      model: 'gpt-image-2.6-flare',
      output_format: 'gif',
      size: '512x512',
      quality: 'low',
      n: 1,
    })
    expect(JSON.stringify(body)).not.toContain(KEY)
  })

  // 封面要與這本故事相符（T4）：prompt 帶入故事標題與英文內容，故事以外的使用者輸入不會進來。
  it('送給模型的 prompt 包含故事標題與內容，並要求圖中不放文字', async () => {
    const { handler, fetchMock } = setup()

    await handler.fetch(coverRequest(), env)

    const { prompt } = sentBody(fetchMock)
    expect(prompt).toContain("Dino's First Day")
    expect(prompt).toContain('Dino walks to school on page 1.')
    expect(prompt).toContain('He waves to Mom.')
    expect(prompt).toMatch(/no (words|text)/i)
  })

  // 成功回應原樣串流轉送（PLAN 3.7），但不帶 OpenAI 的回應 header（例如 organization），並禁止快取。
  it('回 200 與 OpenAI 的圖片 JSON，不轉送 OpenAI 的 header，禁止快取', async () => {
    const { handler } = setup()

    const res = await handler.fetch(coverRequest(), env)

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('openai-organization')).toBeNull()
    expect(await res.json()).toMatchObject({ data: [{ b64_json: GIF_B64 }] })
  })

  it('套用 120 秒逾時 signal 到 OpenAI 請求', async () => {
    const { handler, fetchMock, timeouts } = setup()

    await handler.fetch(coverRequest(), env)

    expect(timeouts.map((t) => t.ms)).toEqual([120_000])
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(timeouts[0]?.controller.signal)
  })
})

describe('POST /api/cover 輸入檢查', () => {
  it('只接受 POST，其他方法回 405 且不呼叫 OpenAI', async () => {
    const { handler, fetchMock } = setup()

    const res = await handler.fetch(coverRequest({ method: 'GET' }), env)

    expect(res.status).toBe(405)
    expect(await res.json()).toEqual({ error: 'method_not_allowed' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('以 http 呼叫時回 insecure_request，不呼叫 OpenAI', async () => {
    const { handler, fetchMock } = setup()

    const res = await handler.fetch(coverRequest({ url: 'http://example.test/api/cover' }), env)

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'insecure_request' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // 封面 API 可被直接呼叫，因此 Worker 不信任 body：不是合格故事（頁數不在 4–10、某頁不是 2 句、空句子）
  // 或 key 不合格時都不轉送 OpenAI，避免浪費使用者的額度。
  it.each([
    ['沒有故事', { body: {} }],
    ['故事只有 3 頁', { body: { story: { ...story, pages: story.pages.slice(0, 3) } } }],
    ['故事有 11 頁', { body: { story: { ...story, pages: [...story.pages, ...story.pages, ...story.pages].slice(0, 11) } } }],
    ['某頁只有一句', { body: { story: { ...story, pages: [{ sentences: [story.pages[0]!.sentences[0]!] }, ...story.pages.slice(1)] } } }],
    ['標題英文是空字串', { body: { story: { ...story, title: { en: ' ', zh: '標題' } } } }],
    ['body 不是 JSON 物件', { body: 'oops' }],
    ['沒有 Authorization', { key: null }],
    ['key 含空白', { key: 'sk-test fake' }],
    ['key 超過 200 字元', { key: 'k'.repeat(201) }],
  ] as const)('%s時回 400 invalid_input，不呼叫 OpenAI', async (_name, options) => {
    const { handler, fetchMock } = setup()

    const res = await handler.fetch(coverRequest(options), env)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_input' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('故事有 10 頁時可以送出', async () => {
    const tenPages = { ...story, pages: [...story.pages, ...story.pages, ...story.pages.slice(0, 2)] }
    const { handler, fetchMock } = setup()

    const res = await handler.fetch(coverRequest({ body: { story: tenPages } }), env)

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/cover 失敗', () => {
  // OpenAI 的 401 訊息會帶回 key 開頭與末 4 碼；封面 API 與文字 API 一樣不能轉送原文或寫進 log。
  // 假回應刻意把 key 放進錯誤訊息，斷言同時檢查回應 body 與所有 console 輸出。
  // 這裡只攔截 console，不能證明部署環境的 Workers Logs 設定，該部分由 T5 部署驗收確認。
  it('OpenAI 回 401 且訊息含 key 時，回應只有 invalid_key，回應與 log 都不含 key', async () => {
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m))
    const { handler, fetchMock } = setup(() =>
      openAIError(401, { message: `Incorrect API key provided: ${KEY} (sk-test-****0000).`, code: 'invalid_api_key' }),
    )

    const res = await handler.fetch(coverRequest(), env)
    const text = await res.text()

    expect(res.status).toBe(401)
    expect(JSON.parse(text)).toEqual({ error: 'invalid_key' })
    expect(text).not.toContain('0000')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(JSON.stringify(logs.flatMap((spy) => spy.mock.calls))).not.toContain('0000')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // 每種 OpenAI 錯誤都對應到本 app 的錯誤類別，且只呼叫一次 OpenAI（不自動重試付費請求）。
  // 403 涵蓋帳戶沒有圖片或 GIF 權限的情況；400 moderation_blocked 是安全系統拒絕這張圖。
  it.each([
    [403, { message: 'GIF output requires access', code: 'model_not_found' }, 403, 'permission_denied'],
    [429, { message: 'slow down', code: 'rate_limit_exceeded' }, 429, 'rate_limited'],
    [429, { message: 'no quota', code: 'insufficient_quota' }, 429, 'insufficient_quota'],
    [400, { message: 'blocked', code: 'moderation_blocked' }, 502, 'cover_refused'],
    [400, { message: 'bad request' }, 502, 'upstream_error'],
    [500, { message: 'boom' }, 502, 'upstream_error'],
  ] as const)('OpenAI 回 %i（%j）時回 %i %s，只呼叫一次', async (status, error, expectedStatus, code) => {
    const { handler, fetchMock } = setup(() => openAIError(status, error))

    const res = await handler.fetch(coverRequest(), env)

    expect(res.status).toBe(expectedStatus)
    expect(await res.json()).toEqual({ error: code })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('連不上 OpenAI 時回 502 network_error，不重試', async () => {
    const { handler, fetchMock } = setup(() => {
      throw new TypeError('fetch failed')
    })

    const res = await handler.fetch(coverRequest(), env)

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'network_error' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // 逾時由注入的 signal 手動觸發（reason 與 AbortSignal.timeout 相同是 TimeoutError），不真的等 120 秒。
  it('等待回應時逾時 signal 觸發，回 504 timeout，不重試', async () => {
    const { handler, fetchMock, timeouts } = setup(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )

    const pending = handler.fetch(coverRequest(), env)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    timeouts[0]!.controller.abort(new DOMException('The operation timed out.', 'TimeoutError'))
    const res = await pending

    expect(res.status).toBe(504)
    expect(await res.json()).toEqual({ error: 'timeout' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // 成功回應是串流轉送，header 已送出後才逾時就無法改回 504；此時必須中斷串流，
  // 讓瀏覽器讀 body 失敗而結束為失敗，而不是讓請求無限掛著（PLAN 3.3）。
  //
  // 假 fetch 自己在 abort 時讓 body 出錯，模擬真實 fetch 被 signal 中斷的行為；因此這個測試證明的是
  // Worker 在 header 先回、body 仍未讀完時就回應（沒有先在 Worker 內讀完 body），且串流錯誤會傳到讀取端。
  // 若 Worker 先讀完 body 才回應，handler.fetch 會等不到結束而讓測試逾時失敗。
  it('轉送 body 途中逾時 signal 觸發時中斷串流，讀取端收到錯誤', async () => {
    const { handler, timeouts } = setup((init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":[{"b64_json":"R0lG'))
          init.signal?.addEventListener('abort', () => controller.error(init.signal?.reason))
        },
      })
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } })
    })

    const res = await handler.fetch(coverRequest(), env)
    const reading = res.text()
    timeouts[0]!.controller.abort(new DOMException('The operation timed out.', 'TimeoutError'))

    await expect(reading).rejects.toThrow()
  })
})
