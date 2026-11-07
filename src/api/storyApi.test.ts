import { describe, expect, it, vi } from 'vitest'
import type { Story } from '../../shared/story'
import { createStoryApi } from './storyApi'

// 注入假的 fetch 與逾時 signal，不連到 Worker；只能證明瀏覽器端送出的請求形狀與回應解讀。
const KEY = 'sk-test-fake0000'
const input = { character: '恐龍', situation: '第一次上學', apiKey: KEY }

const story: Story = {
  title: { en: 'Dino', zh: '小恐龍' },
  pages: [1, 2, 3, 4].map((p) => ({ sentences: [{ en: `Page ${p}.`, zh: `第 ${p} 頁。` }] })),
}

function setup(respond: (init: RequestInit) => Response | Promise<Response> = () => Response.json({ story })) {
  const timeouts: Array<{ ms: number; controller: AbortController }> = []
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => respond(init ?? {}))
  const api = createStoryApi({
    fetch: fetchMock as typeof fetch,
    timeoutSignal: (ms) => {
      const controller = new AbortController()
      timeouts.push({ ms, controller })
      return controller.signal
    },
  })
  return { api, fetchMock, timeouts }
}

describe('createStoryApi().generateStory', () => {
  // key 只能放在 Authorization：Cloudflare 的 log 會完整記錄 URL 與自訂 header（PLAN 3.2）。
  it('以 POST 送到同網域 /api/story，key 只在 Authorization，body 只有角色與情境', async () => {
    const { api, fetchMock } = setup()

    await api.generateStory(input)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('/api/story')
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect([...headers.keys()].sort()).toEqual(['authorization', 'content-type'])
    expect(JSON.parse(String(init?.body))).toEqual({ character: '恐龍', situation: '第一次上學' })
  })

  it('套用 70 秒逾時 signal，比 Worker 的 60 秒多 10 秒', async () => {
    const { api, fetchMock, timeouts } = setup()

    await api.generateStory(input)

    expect(timeouts.map((t) => t.ms)).toEqual([70_000])
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(timeouts[0]?.controller.signal)
  })

  it('成功回應且故事通過驗證時回傳故事', async () => {
    const { api } = setup()

    expect(await api.generateStory(input)).toEqual({ ok: true, story })
  })

  // 前端再驗證一次：即使 Worker 被改壞或回應被竄改，不合格的資料也不會被發佈成新故事。
  it('成功狀態但故事不合格式時回 invalid_story', async () => {
    const { api } = setup(() => Response.json({ story: { ...story, pages: story.pages.slice(0, 3) } }))

    expect(await api.generateStory(input)).toEqual({ ok: false, error: 'invalid_story' })
  })

  it('Worker 的錯誤類別原樣回傳', async () => {
    const invalidKey = setup(() => Response.json({ error: 'invalid_key' }, { status: 401 }))
    expect(await invalidKey.api.generateStory(input)).toEqual({ ok: false, error: 'invalid_key' })

    const invalidInput = setup(() => Response.json({ error: 'invalid_input', fields: ['situation'] }, { status: 400 }))
    expect(await invalidInput.api.generateStory(input)).toEqual({ ok: false, error: 'invalid_input' })
  })

  it('無法解讀或未知的錯誤回應視為 upstream_error', async () => {
    const html = setup(() => new Response('<html>502</html>', { status: 502 }))
    expect(await html.api.generateStory(input)).toEqual({ ok: false, error: 'upstream_error' })

    const unknown = setup(() => Response.json({ error: 'something_new' }, { status: 500 }))
    expect(await unknown.api.generateStory(input)).toEqual({ ok: false, error: 'upstream_error' })
  })

  it('連不上 Worker 時回 network_error，只送一次', async () => {
    const { api, fetchMock } = setup(() => {
      throw new TypeError('Failed to fetch')
    })

    expect(await api.generateStory(input)).toEqual({ ok: false, error: 'network_error' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('逾時 signal 觸發時回 timeout，只送一次', async () => {
    const { api, fetchMock, timeouts } = setup(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )

    const pending = api.generateStory(input)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    timeouts[0]!.controller.abort(new DOMException('The operation timed out.', 'TimeoutError'))

    expect(await pending).toEqual({ ok: false, error: 'timeout' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // 回應標頭已到、讀 body 時才逾時：仍要回 timeout，畫面才會說明「可能已經計費」，
  // 不能被當成格式錯誤（invalid_story）或上游錯誤。
  it('讀取回應 body 時逾時也回 timeout', async () => {
    const { api, fetchMock, timeouts } = setup((init) => {
      const body = new ReadableStream({
        start(controller) {
          init.signal?.addEventListener('abort', () => controller.error(init.signal?.reason))
        },
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
    })

    const pending = api.generateStory(input)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    timeouts[0]!.controller.abort(new DOMException('The operation timed out.', 'TimeoutError'))

    expect(await pending).toEqual({ ok: false, error: 'timeout' })
  })
})
