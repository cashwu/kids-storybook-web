import { describe, expect, it, vi } from 'vitest'
import type { Story } from '../../shared/story'
import { createCoverApi } from './coverApi'

// 注入假的 fetch 與逾時 signal，不連到 Worker；只能證明瀏覽器端送出的請求形狀與回應解讀。
const KEY = 'sk-test-fake0000'

const story: Story = {
  title: { en: 'Dino', zh: '小恐龍' },
  pages: [1, 2, 3, 4].map((p) => ({
    sentences: [
      { en: `Page ${p}.`, zh: `第 ${p} 頁。` },
      { en: 'Again.', zh: '再一次。' },
    ],
  })),
}

/** GIF 檔頭 `GIF89a` 的 base64 開頭。 */
const GIF_B64 = 'R0lGODlhAQABAAAAACw='

function setup(respond: (init: RequestInit) => Response | Promise<Response> = () => Response.json({ data: [{ b64_json: GIF_B64 }] })) {
  const timeouts: Array<{ ms: number; controller: AbortController }> = []
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => respond(init ?? {}))
  const api = createCoverApi({
    fetch: fetchMock as typeof fetch,
    timeoutSignal: (ms) => {
      const controller = new AbortController()
      timeouts.push({ ms, controller })
      return controller.signal
    },
  })
  return { api, fetchMock, timeouts }
}

describe('createCoverApi().generateCover', () => {
  // key 只能放在 Authorization：Cloudflare 的 log 會完整記錄 URL 與自訂 header（PLAN 3.2）。
  it('以 POST 送到同網域 /api/cover，key 只在 Authorization，body 只有故事', async () => {
    const { api, fetchMock } = setup()

    await api.generateCover(story, KEY)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('/api/cover')
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect([...headers.keys()].sort()).toEqual(['authorization', 'content-type'])
    expect(JSON.parse(String(init?.body))).toEqual({ story })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('套用 130 秒逾時 signal，比 Worker 的 120 秒多 10 秒', async () => {
    const { api, fetchMock, timeouts } = setup()

    await api.generateCover(story, KEY)

    expect(timeouts.map((t) => t.ms)).toEqual([130_000])
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(timeouts[0]?.controller.signal)
  })

  it('成功回應帶 GIF 時回傳可給 <img> 用的 GIF data URL', async () => {
    const { api } = setup()

    expect(await api.generateCover(story, KEY)).toEqual({ ok: true, src: `data:image/gif;base64,${GIF_B64}` })
  })

  // 成功狀態但沒有可顯示的 GIF：不能當成封面就緒，否則畫面會顯示破圖且沒有重試入口。
  it.each([
    ['沒有 data', () => Response.json({})],
    ['b64_json 是空字串', () => Response.json({ data: [{ b64_json: '' }] })],
    ['內容不是 GIF（PNG 檔頭）', () => Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] })],
    ['body 不是 JSON', () => new Response('<html>gateway</html>', { status: 200 })],
  ])('成功狀態但%s時回 invalid_cover', async (_name, respond) => {
    const { api } = setup(respond)

    expect(await api.generateCover(story, KEY)).toEqual({ ok: false, error: 'invalid_cover' })
  })

  it.each([
    ['invalid_key', 401],
    ['permission_denied', 403],
    ['cover_refused', 502],
    ['timeout', 504],
  ] as const)('Worker 回 %s 時原樣回傳錯誤類別', async (error, status) => {
    const { api } = setup(() => Response.json({ error }, { status }))

    expect(await api.generateCover(story, KEY)).toEqual({ ok: false, error })
  })

  it('Worker 回未知的錯誤內容時視為 upstream_error', async () => {
    const { api } = setup(() => new Response('<html>502</html>', { status: 502 }))

    expect(await api.generateCover(story, KEY)).toEqual({ ok: false, error: 'upstream_error' })
  })

  it('連不上 Worker 時回 network_error，只送一次', async () => {
    const { api, fetchMock } = setup(() => {
      throw new TypeError('Failed to fetch')
    })

    expect(await api.generateCover(story, KEY)).toEqual({ ok: false, error: 'network_error' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // 封面 body 約 1.5 MB，逾時可能發生在讀 body 途中；這時也必須結束為 timeout，而不是誤判成格式錯誤。
  it.each([
    ['等待回應時', false],
    ['讀取 body 途中', true],
  ])('%s逾時 signal 觸發時回 timeout，只送一次', async (_name, headersFirst) => {
    const { api, fetchMock, timeouts } = setup((init) => {
      if (!headersFirst) {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        })
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":[{"b64_json":"R0lG'))
          init.signal?.addEventListener('abort', () => controller.error(init.signal?.reason))
        },
      })
      return new Response(stream, { status: 200 })
    })

    const pending = api.generateCover(story, KEY)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    timeouts[0]!.controller.abort(new DOMException('The operation timed out.', 'TimeoutError'))

    expect(await pending).toEqual({ ok: false, error: 'timeout' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // Worker 在 header 送出後因自己的逾時中斷串流時，瀏覽器的 signal 還沒觸發，讀 body 會失敗；
  // 這時結束為失敗（network_error），不能把截斷的內容當成封面。
  it('body 串流中途被中斷（瀏覽器未逾時）時回 network_error', async () => {
    const { api } = setup(() => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":[{"b64_json":"R0lG'))
          controller.error(new TypeError('network error'))
        },
      })
      return new Response(stream, { status: 200 })
    })

    expect(await api.generateCover(story, KEY)).toEqual({ ok: false, error: 'network_error' })
  })
})
