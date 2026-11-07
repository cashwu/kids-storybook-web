import { describe, expect, it, vi } from 'vitest'
import type { CoverApiErrorCode } from '../../shared/coverApi'
import type { Story } from '../../shared/story'
import type { CoverApi, GenerateCoverResult } from '../api/coverApi'
import { useCoverGeneration } from './useCoverGeneration'

// 目前這本書的封面狀態（PLAN 3.3、A5–A7）。新故事的第一次封面請求由 request 送出、不改變畫面上的封面，
// 結果與故事文字一起由 publish 發佈；之後失敗只能 retry。
// 假的 API client 由測試決定每個請求何時、以什麼結果結束，不連網；只能證明瀏覽器端的狀態與請求次數，
// 不能證明真實封面的內容或等待時間。

const KEY_A = 'sk-test-keyA0000'
const KEY_B = 'sk-test-keyB0000'

function makeStory(name: string): Story {
  return {
    title: { en: name, zh: `故事 ${name}` },
    pages: [1, 2, 3, 4].map((p) => ({
      sentences: [
        { en: `${name} page ${p}.`, zh: `${name} 第 ${p} 頁。` },
        { en: 'Again.', zh: '再一次。' },
      ],
    })),
  }
}

function fakeApi() {
  const pending: Array<(result: GenerateCoverResult) => void> = []
  const api: CoverApi = {
    generateCover: vi.fn(
      () =>
        new Promise<GenerateCoverResult>((resolve) => {
          pending.push(resolve)
        }),
    ),
  }
  /** 依送出順序結束最早的那個請求。 */
  const respond = async (result: GenerateCoverResult) => {
    pending.shift()!(result)
    await Promise.resolve()
    await Promise.resolve()
  }
  return { api, respond, calls: () => vi.mocked(api.generateCover).mock.calls }
}

const ok = (src: string): GenerateCoverResult => ({ ok: true, src })
const fail = (error: CoverApiErrorCode): GenerateCoverResult => ({ ok: false, error })

function setup() {
  const fake = fakeApi()
  const cover = useCoverGeneration(fake.api)
  return { ...fake, cover }
}

describe('useCoverGeneration', () => {
  it('還沒有書時是 idle，沒有封面也沒有錯誤', () => {
    const { cover, calls } = setup()

    expect(cover.status.value).toBe('idle')
    expect(cover.src.value).toBeNull()
    expect(cover.error.value).toBeNull()
    expect(calls()).toHaveLength(0)
  })

  // A6：等 B 的封面時 A 仍是目前的書，A 的封面要留著；request 只回傳結果，不改變畫面上的封面。
  it('request 以故事與 key 送一次請求並回傳結果，不改變目前這本書的封面', async () => {
    const { cover, calls, respond } = setup()
    cover.publish(makeStory('A'), KEY_A, ok('data:image/gif;base64,A'))
    const storyB = makeStory('B')

    const pending = cover.request(storyB, KEY_B)
    expect(calls()).toEqual([[storyB, KEY_B]])
    expect(cover.src.value).toBe('data:image/gif;base64,A')
    await respond(fail('timeout'))

    expect(await pending).toEqual(fail('timeout'))
    expect(cover.src.value).toBe('data:image/gif;base64,A')
    expect(cover.status.value).toBe('ready')
  })

  it('publish 成功結果時顯示封面；失敗結果時進入 failed、記錄錯誤且不自動重試', () => {
    const { cover, calls } = setup()

    cover.publish(makeStory('A'), KEY_A, ok('data:image/gif;base64,A'))
    expect(cover.status.value).toBe('ready')
    expect(cover.src.value).toBe('data:image/gif;base64,A')

    cover.publish(makeStory('B'), KEY_B, fail('cover_refused'))
    // A6：B 的封面失敗時不能留著 A 的封面。
    expect(cover.src.value).toBeNull()
    expect(cover.status.value).toBe('failed')
    expect(cover.error.value).toBe('cover_refused')
    expect(calls()).toHaveLength(0)
  })

  // A5：手動重試只重送封面，沿用這本書的故事與 key。
  it('失敗後 retry 以同一本故事與 key 再送一次，期間 busy，成功後顯示封面', async () => {
    const { cover, calls, respond } = setup()
    const story = makeStory('A')
    cover.publish(story, KEY_A, fail('upstream_error'))

    cover.retry()

    expect(cover.status.value).toBe('generating')
    expect(cover.busy.value).toBe(true)
    expect(cover.error.value).toBeNull()
    expect(calls()).toEqual([[story, KEY_A]])
    await respond(ok('data:image/gif;base64,A2'))
    expect(cover.status.value).toBe('ready')
    expect(cover.busy.value).toBe(false)
    expect(cover.src.value).toBe('data:image/gif;base64,A2')
  })

  it('retry 再次失敗時回到 failed 並記錄新的錯誤', async () => {
    const { cover, respond } = setup()
    cover.publish(makeStory('A'), KEY_A, fail('upstream_error'))

    cover.retry()
    await respond(fail('timeout'))

    expect(cover.status.value).toBe('failed')
    expect(cover.error.value).toBe('timeout')
  })

  // A7：同一張封面不重複提交。重試中與已成功時按 retry 都不能多送付費請求；還沒有書時沒有可重試的故事。
  it.each([
    ['還沒有書', async () => {}],
    [
      '重試進行中',
      async (ctx: ReturnType<typeof setup>) => {
        ctx.cover.publish(makeStory('A'), KEY_A, fail('timeout'))
        ctx.cover.retry()
      },
    ],
    ['封面已成功', async (ctx: ReturnType<typeof setup>) => ctx.cover.publish(makeStory('A'), KEY_A, ok('data:image/gif;base64,A'))],
  ])('%s時 retry 不送出請求', async (_name, arrange) => {
    const ctx = setup()
    await arrange(ctx)
    const before = ctx.calls().length

    ctx.cover.retry()

    expect(ctx.calls()).toHaveLength(before)
  })

  // A6：舊書的重試若在新書發佈之後才回應，結果不能寫進新書。正常流程中重試進行時不能建立新故事，
  // 這個測試直接呼叫 publish 模擬漏擋的情況，確認狀態本身也不會混入舊封面。
  it('舊書的重試結果晚到時不寫進新書', async () => {
    const { cover, respond } = setup()
    cover.publish(makeStory('A'), KEY_A, fail('timeout'))
    cover.retry()

    cover.publish(makeStory('B'), KEY_B, fail('cover_refused'))
    await respond(ok('data:image/gif;base64,A'))

    expect(cover.src.value).toBeNull()
    expect(cover.status.value).toBe('failed')
    expect(cover.error.value).toBe('cover_refused')
  })

  it('換成新書後 retry 只重送新書的故事與 key', () => {
    const { cover, calls } = setup()
    const storyB = makeStory('B')
    cover.publish(makeStory('A'), KEY_A, fail('timeout'))
    cover.publish(storyB, KEY_B, fail('timeout'))

    cover.retry()

    expect(calls()).toEqual([[storyB, KEY_B]])
  })
})
