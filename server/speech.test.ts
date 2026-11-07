import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorker } from './index'

// POST /api/speech 的 handler 測試：直接呼叫 fetch handler 並注入假的 OpenAI fetch，不經過 workerd、不連網。
// 只能證明 handler 的回應與送給 OpenAI 的請求內容；真實模型的音質、等待時間、單句費用與
// Free 方案的 CPU 用量，由 T9 的真實試聽與部署驗收確認。

/** 明顯的假 key；末 4 碼 0000 對應 OpenAI 401 訊息帶回的 key 片段。 */
const KEY = 'sk-test-fake0000'
const env: Env = {}

/** mp3 frame header 的開頭 bytes，代表 OpenAI 回的是音檔。 */
const MP3_BYTES = new Uint8Array([0xff, 0xf3, 0x44, 0xc4, 0x00])

function speechRequest(options: { url?: string; key?: string | null; body?: unknown; method?: string } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (options.key !== null) headers.set('authorization', `Bearer ${options.key ?? KEY}`)
  const method = options.method ?? 'POST'
  return new Request(options.url ?? 'https://example.test/api/speech', {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(options.body ?? { text: 'Dino goes to school.', language: 'en' }),
  })
}

function openAIAudio() {
  return new Response(MP3_BYTES, {
    headers: { 'content-type': 'audio/mpeg', 'openai-organization': 'org-secret', 'x-request-id': 'req_1' },
  })
}

function openAIError(status: number, error: { message: string; code?: string }) {
  return Response.json({ error }, { status })
}

function setup(respond: (init: RequestInit) => Response | Promise<Response> = () => openAIAudio()) {
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

describe('POST /api/speech 成功', () => {
  // 聲音、語速與格式是部署設定（PLAN 3.8「模型與期限」，2026-11-07 試聽確認），瀏覽器不能指定。
  it('轉送 /v1/audio/speech：key 只在 Authorization，使用 gpt-4o-mini-tts、sage、speed 1.0 與 mp3', async () => {
    const { handler, fetchMock } = setup()

    await handler.fetch(speechRequest(), env)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/audio/speech')
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${KEY}`)
    const body = sentBody(fetchMock)
    expect(body).toMatchObject({
      model: 'gpt-4o-mini-tts',
      voice: 'sage',
      input: 'Dino goes to school.',
      response_format: 'mp3',
      speed: 1,
    })
    expect(JSON.stringify(body)).not.toContain(KEY)
  })

  // 英文與中文使用各自試聽確認的語氣指示：中文要求台灣口音，且多一句要求開頭就用正常音量
  // （試聽時中文開頭偏小聲，PLAN 第 5 節）。指示用錯語言時，中文句子會以英文初學者的語氣念，或缺少台灣口音的要求。
  it.each([
    ['en', 'Dino goes to school.', /beginning to learn English/, /Taiwan/],
    ['zh', '小恐龍去上學。', /Taiwanese accent/, /beginning to learn English/],
  ] as const)('語言 %s 用該語言的語氣指示，文字原樣轉送', async (language, text, expected, unexpected) => {
    const { handler, fetchMock } = setup()

    await handler.fetch(speechRequest({ body: { text, language } }), env)

    const body = sentBody(fetchMock)
    expect(body.input).toBe(text)
    expect(body.instructions).toMatch(expected)
    expect(body.instructions).not.toMatch(unexpected)
  })

  it('中文語氣指示要求從第一個字就用正常音量', async () => {
    const { handler, fetchMock } = setup()

    await handler.fetch(speechRequest({ body: { text: '小恐龍去上學。', language: 'zh' } }), env)

    expect(sentBody(fetchMock).instructions).toMatch(/normal speaking volume from the very first word/)
  })

  it('句子頭尾的空白去除後才轉送', async () => {
    const { handler, fetchMock } = setup()

    await handler.fetch(speechRequest({ body: { text: '  Dino waves.  ', language: 'en' } }), env)

    expect(sentBody(fetchMock).input).toBe('Dino waves.')
  })

  // 成功回應原樣串流轉送，不帶 OpenAI 的回應 header（例如 organization），並禁止快取。
  it('回 200 與 mp3 內容，content-type 為 audio/mpeg，不轉送 OpenAI 的 header，禁止快取', async () => {
    const { handler } = setup()

    const res = await handler.fetch(speechRequest(), env)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('openai-organization')).toBeNull()
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(MP3_BYTES)
  })

  it('套用 30 秒逾時 signal 到 OpenAI 請求', async () => {
    const { handler, fetchMock, timeouts } = setup()

    await handler.fetch(speechRequest(), env)

    expect(timeouts.map((t) => t.ms)).toEqual([30_000])
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(timeouts[0]?.controller.signal)
  })
})

describe('POST /api/speech 輸入檢查', () => {
  it('只接受 POST，其他方法回 405 且不呼叫 OpenAI', async () => {
    const { handler, fetchMock } = setup()

    const res = await handler.fetch(speechRequest({ method: 'GET' }), env)

    expect(res.status).toBe(405)
    expect(await res.json()).toEqual({ error: 'method_not_allowed' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('以 http 呼叫時回 insecure_request，不呼叫 OpenAI', async () => {
    const { handler, fetchMock } = setup()

    const res = await handler.fetch(speechRequest({ url: 'http://example.test/api/speech' }), env)

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'insecure_request' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // 語音 API 可被直接呼叫，Worker 不信任 body（PLAN 3.8「Key 與逾時」）：每次轉送都由使用者的 key 計費，
  // 不合格的句子或 key 不轉送 OpenAI。500 字元以 code point 計算，中文字也算 1 個。
  it.each([
    ['沒有 body 欄位', { body: {} }],
    ['語言不是 en 或 zh', { body: { text: 'Hi.', language: 'fr' } }],
    ['沒有語言', { body: { text: 'Hi.' } }],
    ['文字只有空白', { body: { text: '   ', language: 'en' } }],
    ['文字不是字串', { body: { text: 42, language: 'en' } }],
    ['文字超過 500 字元', { body: { text: '好'.repeat(501), language: 'zh' } }],
    ['body 不是 JSON 物件', { body: 'oops' }],
    ['沒有 Authorization', { key: null }],
    ['key 含空白', { key: 'sk-test fake' }],
    ['key 超過 200 字元', { key: 'k'.repeat(201) }],
  ] as const)('%s時回 400 invalid_input，不呼叫 OpenAI', async (_name, options) => {
    const { handler, fetchMock } = setup()

    const res = await handler.fetch(speechRequest(options), env)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_input' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('文字剛好 500 字元時可以送出', async () => {
    const { handler, fetchMock } = setup()

    const res = await handler.fetch(speechRequest({ body: { text: '好'.repeat(500), language: 'zh' } }), env)

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/speech 失敗', () => {
  // OpenAI 的 401 訊息會帶回 key 開頭與末 4 碼（V8）；語音 API 與其他 API 一樣不能轉送原文或寫進 log。
  // 假回應刻意把 key 放進錯誤訊息，斷言同時檢查回應 body 與所有 console 輸出。
  // 這裡只攔截 console，不能證明部署環境的 Workers Logs 設定，該部分由部署驗收確認。
  it('OpenAI 回 401 且訊息含 key 時，回應只有 invalid_key，回應與 log 都不含 key', async () => {
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m))
    const { handler, fetchMock } = setup(() =>
      openAIError(401, { message: `Incorrect API key provided: ${KEY} (sk-test-****0000).`, code: 'invalid_api_key' }),
    )

    const res = await handler.fetch(speechRequest(), env)
    const text = await res.text()

    expect(res.status).toBe(401)
    expect(JSON.parse(text)).toEqual({ error: 'invalid_key' })
    expect(text).not.toContain('0000')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(JSON.stringify(logs.flatMap((spy) => spy.mock.calls))).not.toContain('0000')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // 每種 OpenAI 錯誤都對應到本 app 的錯誤類別，且只呼叫一次 OpenAI（不自動重試付費請求）。
  // V5 的「額度不足」是 429 insufficient_quota。
  it.each([
    [403, { message: 'no access', code: 'model_not_found' }, 403, 'permission_denied'],
    [429, { message: 'slow down', code: 'rate_limit_exceeded' }, 429, 'rate_limited'],
    [429, { message: 'no quota', code: 'insufficient_quota' }, 429, 'insufficient_quota'],
    [400, { message: 'bad request' }, 502, 'upstream_error'],
    [500, { message: 'boom' }, 502, 'upstream_error'],
  ] as const)('OpenAI 回 %i（%j）時回 %i %s，只呼叫一次', async (status, error, expectedStatus, code) => {
    const { handler, fetchMock } = setup(() => openAIError(status, error))

    const res = await handler.fetch(speechRequest(), env)

    expect(res.status).toBe(expectedStatus)
    expect(await res.json()).toEqual({ error: code })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('連不上 OpenAI 時回 502 network_error，不重試', async () => {
    const { handler, fetchMock } = setup(() => {
      throw new TypeError('fetch failed')
    })

    const res = await handler.fetch(speechRequest(), env)

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'network_error' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // 逾時由注入的 signal 手動觸發（reason 與 AbortSignal.timeout 相同是 TimeoutError），不真的等 30 秒。
  it('等待回應時逾時 signal 觸發，回 504 timeout，不重試', async () => {
    const { handler, fetchMock, timeouts } = setup(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )

    const pending = handler.fetch(speechRequest(), env)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    timeouts[0]!.controller.abort(new DOMException('The operation timed out.', 'TimeoutError'))
    const res = await pending

    expect(res.status).toBe(504)
    expect(await res.json()).toEqual({ error: 'timeout' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // 成功回應是串流轉送，header 已送出後才逾時就無法改回 504；此時必須中斷串流，
  // 讓瀏覽器讀 body 失敗而結束為失敗，而不是讓請求無限掛著（PLAN 3.3）。
  // 假 fetch 在 abort 時讓 body 出錯，模擬真實 fetch 被 signal 中斷；若 Worker 先讀完 body 才回應，
  // handler.fetch 會等不到結束而讓測試逾時失敗。
  it('轉送 body 途中逾時 signal 觸發時中斷串流，讀取端收到錯誤', async () => {
    const { handler, timeouts } = setup((init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(MP3_BYTES)
          init.signal?.addEventListener('abort', () => controller.error(init.signal?.reason))
        },
      })
      return new Response(stream, { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    })

    const res = await handler.fetch(speechRequest(), env)
    const reading = res.arrayBuffer()
    timeouts[0]!.controller.abort(new DOMException('The operation timed out.', 'TimeoutError'))

    await expect(reading).rejects.toThrow()
  })
})
