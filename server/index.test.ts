import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Story } from '../shared/story'
import worker, { createWorker } from './index'

// 這些測試直接呼叫 fetch handler 並注入假的 OpenAI fetch，不經過 workerd、不連網。
// 只能證明 handler 本身的回應與送給 OpenAI 的請求內容；wrangler 的 run_worker_first 路由、
// 部署環境的 Workers Logs 與真實模型的輸出品質，由本機 wrangler dev、真實試驗與 T5 部署驗收確認。

/** 明顯的假 key；末 4 碼 0000 對應 A3 中 OpenAI 401 訊息帶回的 key 片段。 */
const KEY = 'sk-test-fake0000'
const env: Env = {}

const story: Story = {
  title: { en: "Dino's First Day", zh: '小恐龍上學去' },
  pages: [0, 1, 2, 3].map((p) => ({
    sentences: [
      { en: `Dino is on page ${p + 1}.`, zh: `小恐龍在第 ${p + 1} 頁。` },
      { en: 'He is happy.', zh: '他很開心。' },
    ],
  })),
}

function storyRequest(options: { url?: string; key?: string | null; body?: unknown; method?: string } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (options.key !== null) headers.set('authorization', `Bearer ${options.key ?? KEY}`)
  const method = options.method ?? 'POST'
  return new Request(options.url ?? 'https://example.test/api/story', {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(options.body ?? { character: '恐龍', situation: '第一次上學', pageCount: 4 }),
  })
}

/** 模擬 Responses API 的成功回應：結構化輸出放在 message 的 output_text 裡。 */
function openAIResponse(content: unknown[], extra: Record<string, unknown> = {}) {
  return Response.json({
    status: 'completed',
    output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content }],
    ...extra,
  })
}

function openAIText(value: unknown) {
  return openAIResponse([{ type: 'output_text', text: typeof value === 'string' ? value : JSON.stringify(value) }])
}

function openAIError(status: number, error: { message: string; code?: string; type?: string }) {
  return Response.json({ error }, { status })
}

function setup(respond: (init: RequestInit) => Response | Promise<Response> = () => openAIText(story)) {
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

describe('Worker /api 路由', () => {
  it('尚未定義的 /api 路徑回 404 JSON，不回前端頁面', async () => {
    const res = await worker.fetch(new Request('https://example.test/api/unknown'), env)

    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  it('故事 API 只接受 POST，其他方法回 405 且不呼叫 OpenAI', async () => {
    const { handler, fetchMock } = setup()

    const res = await handler.fetch(storyRequest({ method: 'GET' }), env)

    expect(res.status).toBe(405)
    expect(await res.json()).toEqual({ error: 'method_not_allowed' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // workers.dev 的 http 網址不會自動轉 https（PLAN 3.2、T0 實測），key 會以明文經過網路；
  // Worker 必須在讀取 key 之前就拒絕，而且不轉送 OpenAI。
  it('以 http 呼叫 API 時回 insecure_request，不呼叫 OpenAI', async () => {
    const { handler, fetchMock } = setup()

    const res = await handler.fetch(storyRequest({ url: 'http://kids.example.test/api/story' }), env)

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'insecure_request' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // 本機開發（vite dev、wrangler dev）只有 http://localhost；loopback 連線不經過外部網路，
  // 部署後的請求 hostname 一定是部署網域，不會落入這個例外。
  it.each(['http://localhost:5173', 'http://127.0.0.1:8787', 'http://[::1]:8787'])(
    '本機 loopback 的 http（%s）仍可呼叫故事 API',
    async (origin) => {
      const { handler } = setup()

      const res = await handler.fetch(storyRequest({ url: `${origin}/api/story` }), env)

      expect(res.status).toBe(200)
    },
  )
})

describe('POST /api/story 成功', () => {
  it('轉送 Responses API：key 只在 Authorization，關閉 store 並要求嚴格 JSON schema', async () => {
    const { handler, fetchMock } = setup()

    await handler.fetch(storyRequest(), env)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://api.openai.com/v1/responses')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${KEY}`)
    expect(String(init?.body)).not.toContain(KEY)

    const body = sentBody(fetchMock)
    expect(body.store).toBe(false)
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true })
    expect(body.text.format.schema.properties.pages).toMatchObject({ minItems: 4, maxItems: 4 })
    // 每頁固定 2 句：schema 與指示都要明確要求，模型才不會每頁只寫一句。
    expect(body.text.format.schema.properties.pages.items.properties.sentences).toMatchObject({ minItems: 2, maxItems: 2 })
    expect(JSON.stringify(body.input)).toContain('exactly 2')
  })

  it('未設定環境變數時使用 gpt-6-luna 與 medium；設定時使用部署設定的值', async () => {
    const defaults = setup()
    await defaults.handler.fetch(storyRequest(), env)
    expect(sentBody(defaults.fetchMock)).toMatchObject({ model: 'gpt-6-luna', reasoning: { effort: 'medium' } })

    const custom = setup()
    await custom.handler.fetch(storyRequest(), {
      OPENAI_TEXT_MODEL: 'gpt-test-model',
      OPENAI_TEXT_REASONING_EFFORT: 'low',
    })
    expect(sentBody(custom.fetchMock)).toMatchObject({ model: 'gpt-test-model', reasoning: { effort: 'low' } })
  })

  // 沒有年齡欄位，請求固定以 4–5 歲為對象（PLAN 3.1、A2）；角色與情境要以去除頭尾空白後的內容送出。
  it('送給模型的需求包含去除頭尾空白的角色、情境與固定的 4–5 歲對象', async () => {
    const { handler, fetchMock } = setup()

    await handler.fetch(storyRequest({ body: { character: '  消防車 ', situation: ' 明天要看牙醫 ', pageCount: 4 } }), env)

    const input = JSON.stringify(sentBody(fetchMock).input)
    expect(input).toContain('消防車')
    expect(input).toContain('明天要看牙醫')
    expect(input).not.toContain('  消防車 ')
    expect(input).toMatch(/4[–-]5/)
  })

  // 使用者選的頁數要同時進入模型指示與 JSON schema，並用來驗證輸出（PLAN 3.1、A2、A4）。
  it('選 6 頁時，指示與 schema 都要求 6 頁，模型回 6 頁才成功', async () => {
    const sixPages = { ...story, pages: [...story.pages, ...story.pages.slice(0, 2)] }
    const { handler, fetchMock } = setup(() => openAIText(sixPages))

    const res = await handler.fetch(storyRequest({ body: { character: '恐龍', situation: '上學', pageCount: 6 } }), env)

    const body = sentBody(fetchMock)
    expect(body.text.format.schema.properties.pages).toMatchObject({ minItems: 6, maxItems: 6 })
    expect(JSON.stringify(body.input)).toContain('Exactly 6 pages')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ story: sixPages })
  })

  it('模型輸出通過驗證時回 200 與故事，並禁止快取', async () => {
    const { handler } = setup()

    const res = await handler.fetch(storyRequest(), env)

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ story })
  })

  it('套用 60 秒逾時 signal 到 OpenAI 請求', async () => {
    const { handler, fetchMock, timeouts } = setup()

    await handler.fetch(storyRequest(), env)

    expect(timeouts.map((t) => t.ms)).toEqual([60_000])
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(timeouts[0]?.controller.signal)
  })
})

describe('POST /api/story 輸入檢查', () => {
  // 輸入不合格時連 OpenAI 都不呼叫，避免浪費使用者的額度（A2）。
  it.each([
    ['角色只有空白', { body: { character: '   ', situation: '上學', pageCount: 4 } }, ['character']],
    ['情境 101 字元', { body: { character: '恐龍', situation: 'a'.repeat(101), pageCount: 4 } }, ['situation']],
    ['角色不是字串', { body: { character: 1, situation: '上學', pageCount: 4 } }, ['character']],
    ['頁數 11', { body: { character: '恐龍', situation: '上學', pageCount: 11 } }, ['pageCount']],
    ['沒有頁數', { body: { character: '恐龍', situation: '上學' } }, ['pageCount']],
    ['頁數是字串', { body: { character: '恐龍', situation: '上學', pageCount: '6' } }, ['pageCount']],
    ['body 不是 JSON 物件', { body: 'oops' }, ['character', 'situation', 'pageCount']],
    ['沒有 Authorization', { key: null }, ['apiKey']],
    ['key 超過 200 字元', { key: 'k'.repeat(201) }, ['apiKey']],
  ] as const)('%s時回 400 invalid_input 並指出欄位', async (_name, options, fields) => {
    const { handler, fetchMock } = setup()

    const res = await handler.fetch(storyRequest(options), env)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_input', fields })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('body 不是合法 JSON 時回 invalid_input', async () => {
    const { handler, fetchMock } = setup()
    const request = new Request('https://example.test/api/story', {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}` },
      body: '{not json',
    })

    const res = await handler.fetch(request, env)

    expect(await res.json()).toEqual({ error: 'invalid_input', fields: ['character', 'situation', 'pageCount'] })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/story 失敗', () => {
  // A3：OpenAI 的 401 訊息會帶回 key 開頭與末 4 碼。若 Worker 轉送原文或寫進 log，
  // key 片段就會出現在瀏覽器 DevTools 或 Cloudflare 的 Workers Logs。
  // 假回應刻意把完整 key 與遮蔽後的片段都放進錯誤訊息，斷言同時檢查回應 body 與所有 console 輸出。
  // 這裡只攔截 console，不能證明部署環境的 Workers Logs 設定，該部分由 T5 部署驗收確認。
  it('OpenAI 回 401 且訊息含 key 時，回應只有 invalid_key，回應與 log 都不含 key', async () => {
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m))
    const { handler, fetchMock } = setup(() =>
      openAIError(401, {
        message: `Incorrect API key provided: ${KEY} (sk-test-****0000).`,
        code: 'invalid_api_key',
      }),
    )

    const res = await handler.fetch(storyRequest(), env)
    const text = await res.text()

    expect(res.status).toBe(401)
    expect(JSON.parse(text)).toEqual({ error: 'invalid_key' })
    expect(text).not.toContain('0000')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const logged = JSON.stringify(logs.flatMap((spy) => spy.mock.calls))
    expect(logged).not.toContain('0000')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // 每種 OpenAI 錯誤都對應到本 app 的錯誤類別，且只呼叫一次 OpenAI（不自動重試付費請求）。
  it.each([
    [403, { message: 'no access', code: 'model_not_found' }, 403, 'permission_denied'],
    [429, { message: 'slow down', code: 'rate_limit_exceeded' }, 429, 'rate_limited'],
    [429, { message: 'no quota', code: 'insufficient_quota' }, 429, 'insufficient_quota'],
    [500, { message: 'boom' }, 502, 'upstream_error'],
    [400, { message: 'bad request' }, 502, 'upstream_error'],
  ] as const)('OpenAI 回 %i（%j）時回 %i %s，只呼叫一次', async (status, error, expectedStatus, code) => {
    const { handler, fetchMock } = setup(() => openAIError(status, error))

    const res = await handler.fetch(storyRequest(), env)

    expect(res.status).toBe(expectedStatus)
    expect(await res.json()).toEqual({ error: code })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('連不上 OpenAI 時回 502 network_error，不重試', async () => {
    const { handler, fetchMock } = setup(() => {
      throw new TypeError('fetch failed')
    })

    const res = await handler.fetch(storyRequest(), env)

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'network_error' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // 逾時由注入的 signal 手動觸發（reason 與 AbortSignal.timeout 相同是 TimeoutError），不真的等 60 秒。
  it('逾時 signal 觸發時回 504 timeout，不重試', async () => {
    const { handler, fetchMock, timeouts } = setup(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )

    const pending = handler.fetch(storyRequest(), env)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    timeouts[0]!.controller.abort(new DOMException('The operation timed out.', 'TimeoutError'))
    const res = await pending

    expect(res.status).toBe(504)
    expect(await res.json()).toEqual({ error: 'timeout' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // A4：不合格的輸出不能當成故事回給瀏覽器，否則前端會把它發佈並開始請求封面。
  it.each([
    ['選 4 頁卻只有三頁', () => openAIText({ ...story, pages: story.pages.slice(0, 3) })],
    ['某頁只有一句', () => openAIText({ ...story, pages: [{ sentences: [story.pages[0]!.sentences[0]!] }, ...story.pages.slice(1)] })],
    // 句數維持 2 句，讓這個案例只違反「英文非空」，不會先被句數檢查擋下。
    ['英文是空字串', () => openAIText({ ...story, pages: [{ sentences: [{ en: '', zh: '空' }, story.pages[0]!.sentences[1]!] }, ...story.pages.slice(1)] })],
    ['輸出不是 JSON', () => openAIText('Once upon a time')],
    ['沒有 message 輸出', () => Response.json({ status: 'completed', output: [] })],
    // 截斷的內容即使剛好是合格故事也不採用，因此這裡放完整的故事 JSON，只有 status 不同。
    ['回應被截斷（incomplete）', () => openAIResponse([{ type: 'output_text', text: JSON.stringify(story) }], { status: 'incomplete' })],
  ])('模型%s時回 502 invalid_story', async (_name, respond) => {
    const { handler } = setup(respond)

    const res = await handler.fetch(storyRequest(), env)

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'invalid_story' })
  })

  it('模型拒絕產生時回 502 story_refused', async () => {
    const { handler } = setup(() => openAIResponse([{ type: 'refusal', refusal: "I can't help with that." }]))

    const res = await handler.fetch(storyRequest(), env)

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'story_refused' })
  })

  it('成功狀態但 body 不是 JSON 時回 502 upstream_error', async () => {
    const { handler } = setup(() => new Response('<html>gateway</html>', { status: 200 }))

    const res = await handler.fetch(storyRequest(), env)

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'upstream_error' })
  })
})
