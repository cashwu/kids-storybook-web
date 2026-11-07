import { describe, expect, it, vi } from 'vitest'
import { createSpeechApi } from './speechApi'

// 注入假的 fetch 與逾時 signal，不連到 Worker；只能證明瀏覽器端送出的請求形狀與回應解讀，
// 不能證明瀏覽器能否實際播放回來的 mp3（由本機與 iOS Safari 實機驗收確認）。
const KEY = 'sk-test-fake0000'

const MP3_BYTES = new Uint8Array([0xff, 0xf3, 0x44, 0xc4, 0x00])

function audioResponse(bytes: Uint8Array<ArrayBuffer> = MP3_BYTES, contentType = 'audio/mpeg') {
  return new Response(bytes, { headers: { 'content-type': contentType } })
}

function setup(respond: (init: RequestInit) => Response | Promise<Response> = () => audioResponse()) {
  const timeouts: Array<{ ms: number; controller: AbortController }> = []
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => respond(init ?? {}))
  const api = createSpeechApi({
    fetch: fetchMock as typeof fetch,
    timeoutSignal: (ms) => {
      const controller = new AbortController()
      timeouts.push({ ms, controller })
      return controller.signal
    },
  })
  return { api, fetchMock, timeouts }
}

describe('createSpeechApi().generateSpeech', () => {
  // key 只能放在 Authorization：Cloudflare 的 log 會完整記錄 URL 與自訂 header（PLAN 3.2、V8）。
  it('以 POST 送到同網域 /api/speech，key 只在 Authorization，body 只有句子與語言', async () => {
    const { api, fetchMock } = setup()

    await api.generateSpeech('小恐龍去上學。', 'zh', KEY)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('/api/speech')
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect([...headers.keys()].sort()).toEqual(['authorization', 'content-type'])
    expect(JSON.parse(String(init?.body))).toEqual({ text: '小恐龍去上學。', language: 'zh' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('套用 40 秒逾時 signal，比 Worker 的 30 秒多 10 秒', async () => {
    const { api, fetchMock, timeouts } = setup()

    await api.generateSpeech('Hi.', 'en', KEY)

    expect(timeouts.map((t) => t.ms)).toEqual([40_000])
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(timeouts[0]?.controller.signal)
  })

  it('成功時回傳 audio Blob，內容與 Worker 回的 mp3 相同', async () => {
    const { api } = setup()

    const result = await api.generateSpeech('Hi.', 'en', KEY)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.audio.type).toBe('audio/mpeg')
    expect(new Uint8Array(await result.audio.arrayBuffer())).toEqual(MP3_BYTES)
  })

  // 200 但不是音檔（例如代理回的 HTML 頁面）或是空內容時，不交給 <audio> 播放，結束為失敗讓使用者手動重試。
  it.each([
    ['content-type 不是 audio', audioResponse(MP3_BYTES, 'text/html')],
    ['內容是空的', audioResponse(new Uint8Array(0))],
  ])('%s時回 invalid_audio', async (_name, response) => {
    const { api } = setup(() => response)

    expect(await api.generateSpeech('Hi.', 'en', KEY)).toEqual({ ok: false, error: 'invalid_audio' })
  })

  it('Worker 回本 app 的錯誤類別時原樣回傳', async () => {
    const { api } = setup(() => Response.json({ error: 'insufficient_quota' }, { status: 429 }))

    expect(await api.generateSpeech('Hi.', 'en', KEY)).toEqual({ ok: false, error: 'insufficient_quota' })
  })

  it('錯誤 body 不是本 app 的錯誤類別時回 upstream_error', async () => {
    const { api } = setup(() => new Response('<html>bad gateway</html>', { status: 502 }))

    expect(await api.generateSpeech('Hi.', 'en', KEY)).toEqual({ ok: false, error: 'upstream_error' })
  })

  it('連不上 Worker 時回 network_error，只送一次', async () => {
    const { api, fetchMock } = setup(() => {
      throw new TypeError('Failed to fetch')
    })

    expect(await api.generateSpeech('Hi.', 'en', KEY)).toEqual({ ok: false, error: 'network_error' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // 逾時由注入的 signal 手動觸發，不真的等 40 秒；逾時要結束為失敗，不讓「生成中」永遠掛著（PLAN 3.8）。
  it('等待回應時逾時 signal 觸發，回 timeout，只送一次', async () => {
    const { api, fetchMock, timeouts } = setup(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )

    const pending = api.generateSpeech('Hi.', 'en', KEY)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    timeouts[0]!.controller.abort(new DOMException('The operation timed out.', 'TimeoutError'))

    expect(await pending).toEqual({ ok: false, error: 'timeout' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // Worker 自己逾時會中斷 mp3 串流：讀 body 失敗時結束為失敗，截斷的音檔不會被當成成功。
  it('讀 body 途中串流中斷時回 network_error，不回傳截斷的音檔', async () => {
    const { api } = setup(() => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(MP3_BYTES)
          controller.error(new TypeError('stream aborted'))
        },
      })
      return new Response(stream, { headers: { 'content-type': 'audio/mpeg' } })
    })

    expect(await api.generateSpeech('Hi.', 'en', KEY)).toEqual({ ok: false, error: 'network_error' })
  })
})
