import { describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import type { Story } from '../../shared/story'
import type { StoryApiErrorCode } from '../../shared/storyApi'
import type { GenerateStoryResult, StoryApi } from '../api/storyApi'
import { createFakeSpeechEngine, enUS } from '../speech/fakeSpeechEngine'
import { useNarration } from '../speech/useNarration'
import { useStoryGeneration } from './useStoryGeneration'

const KEY = 'sk-test-fake0000'

function makeStory(name: string): Story {
  return {
    title: { en: name, zh: `故事 ${name}` },
    pages: [1, 2, 3, 4].map((p) => ({ sentences: [{ en: `${name} page ${p}.`, zh: `${name} 第 ${p} 頁。` }] })),
  }
}

/** 假的 API client：每次呼叫回傳一個由測試決定何時、以什麼結果結束的請求。 */
function fakeApi() {
  const pending: Array<(result: GenerateStoryResult) => void> = []
  const api: StoryApi = {
    generateStory: vi.fn(
      () =>
        new Promise<GenerateStoryResult>((resolve) => {
          pending.push(resolve)
        }),
    ),
  }
  const respond = (result: GenerateStoryResult) => pending.shift()!(result)
  return { api, respond, calls: () => vi.mocked(api.generateStory).mock.calls }
}

const fail = (error: StoryApiErrorCode): GenerateStoryResult => ({ ok: false, error })

/** 真的 useNarration 搭配假 engine，讓測試能觀察替換故事時朗讀高亮與 engine.cancel 的實際結果。 */
function fakeNarration() {
  const engine = createFakeSpeechEngine([enUS])
  const narration = effectScope().run(() => useNarration({ engine, rate: 0.1 }))!
  return { engine, narration }
}

function setup() {
  const fake = fakeApi()
  const speech = fakeNarration()
  const gen = useStoryGeneration(fake.api, speech.narration)
  gen.form.apiKey = KEY
  return { ...fake, ...speech, gen }
}

/** 送出並以指定結果完成這次請求。 */
async function submitWith(ctx: ReturnType<typeof setup>, result: GenerateStoryResult) {
  const done = ctx.gen.submit()
  ctx.respond(result)
  await done
}

describe('useStoryGeneration 初始狀態', () => {
  // 角色與情境預填 Demo 案例方便測試；key 一律不預填（PLAN 3.1）。
  it('角色與情境預填 Demo 案例、頁數預設 4、key 空白，沒有故事且表單展開', () => {
    const gen = useStoryGeneration(fakeApi().api, fakeNarration().narration)

    expect(gen.form).toEqual({ character: '恐龍', situation: '第一次上學，有點害怕和媽媽分開', pageCount: 4, apiKey: '' })
    expect(gen.story.value).toBeNull()
    expect(gen.formOpen.value).toBe(true)
    expect(gen.status.value).toBe('idle')
  })
})

describe('useStoryGeneration 送出', () => {
  it('輸入不合格時標出欄位，不送出請求', async () => {
    const ctx = setup()
    ctx.gen.form.character = '   '
    ctx.gen.form.pageCount = 11
    ctx.gen.form.apiKey = ''

    await ctx.gen.submit()

    expect(ctx.gen.fieldErrors.value).toEqual({ character: 'required', pageCount: 'out_of_range', apiKey: 'required' })
    expect(ctx.calls()).toHaveLength(0)
    expect(ctx.gen.status.value).toBe('idle')
  })

  it('合格時以去除頭尾空白的輸入與所選頁數送出，期間狀態為 generating', async () => {
    const ctx = setup()
    ctx.gen.form.character = ' 恐龍 '
    ctx.gen.form.pageCount = 10

    const done = ctx.gen.submit()

    expect(ctx.gen.status.value).toBe('generating')
    expect(ctx.calls()[0]?.[0]).toEqual({ character: '恐龍', situation: '第一次上學，有點害怕和媽媽分開', pageCount: 10, apiKey: KEY })
    ctx.respond({ ok: true, story: makeStory('A') })
    await done
  })

  it('修正欄位後再送出會清除先前的欄位錯誤', async () => {
    const ctx = setup()
    ctx.gen.form.situation = ''
    await ctx.gen.submit()
    ctx.gen.form.situation = '看牙醫'

    await submitWith(ctx, { ok: true, story: makeStory('A') })

    expect(ctx.gen.fieldErrors.value).toEqual({})
  })

  it('文字成功後發佈故事、收合表單並回到 idle', async () => {
    const ctx = setup()

    await submitWith(ctx, { ok: true, story: makeStory('A') })

    expect(ctx.gen.story.value).toEqual(makeStory('A'))
    expect(ctx.gen.formOpen.value).toBe(false)
    expect(ctx.gen.status.value).toBe('idle')
    expect(ctx.gen.error.value).toBeNull()
  })

  // A7：生成中再按送出若又發出請求，使用者會被重複計費，也可能讓較慢的舊回應蓋掉新回應。
  it('生成中再次送出不會多送請求', async () => {
    const ctx = setup()

    const first = ctx.gen.submit()
    await ctx.gen.submit()
    await ctx.gen.submit()

    expect(ctx.calls()).toHaveLength(1)
    ctx.respond({ ok: true, story: makeStory('A') })
    await first
  })

  // A9：故事資料會被顯示、之後也可能被匯出，不能夾帶 key。
  it('發佈的故事資料不含 key', async () => {
    const ctx = setup()

    await submitWith(ctx, { ok: true, story: makeStory('A') })

    expect(JSON.stringify(ctx.gen.story.value)).not.toContain(KEY)
  })
})

describe('useStoryGeneration 失敗與手動重試', () => {
  // A3：失敗時保留使用者的輸入（含 key），更正後可直接手動再試；沒有故事時表單維持展開。
  it('文字失敗時記錄錯誤類別、保留輸入，不發佈故事', async () => {
    const ctx = setup()

    await submitWith(ctx, fail('invalid_key'))

    expect(ctx.gen.status.value).toBe('failed')
    expect(ctx.gen.error.value).toBe('invalid_key')
    expect(ctx.gen.story.value).toBeNull()
    expect(ctx.gen.form).toEqual({ character: '恐龍', situation: '第一次上學，有點害怕和媽媽分開', pageCount: 4, apiKey: KEY })
    expect(ctx.gen.formOpen.value).toBe(true)
  })

  // A7：失敗（包含逾時）只結束為 failed，不自動再送；再送一次只能由使用者手動觸發。
  it('逾時失敗後不會自動重送，使用者再按才送第二次，成功後清除錯誤', async () => {
    const ctx = setup()
    await submitWith(ctx, fail('timeout'))

    expect(ctx.calls()).toHaveLength(1)
    expect(ctx.gen.error.value).toBe('timeout')

    await submitWith(ctx, { ok: true, story: makeStory('A') })

    expect(ctx.calls()).toHaveLength(2)
    expect(ctx.gen.status.value).toBe('idle')
    expect(ctx.gen.error.value).toBeNull()
  })
})

describe('useStoryGeneration 建立新故事', () => {
  async function withStoryA() {
    const ctx = setup()
    await submitWith(ctx, { ok: true, story: makeStory('A') })
    ctx.gen.openForm()
    return ctx
  }

  // A6：新故事 B 在文字成功前，舊故事 A 要一直可讀；B 失敗時 A 不能被清掉或換成不完整的資料。
  it('已有故事 A 時建立 B，生成中與 B 失敗後都仍顯示 A', async () => {
    const ctx = await withStoryA()
    ctx.gen.form.situation = '看牙醫'

    const done = ctx.gen.submit()
    expect(ctx.gen.story.value).toEqual(makeStory('A'))
    ctx.respond(fail('invalid_story'))
    await done

    expect(ctx.gen.story.value).toEqual(makeStory('A'))
    expect(ctx.gen.error.value).toBe('invalid_story')
    expect(ctx.gen.formOpen.value).toBe(true)
  })

  it('B 文字成功後換成 B、版本號遞增並再次收合表單', async () => {
    const ctx = await withStoryA()
    const versionA = ctx.gen.storyVersion.value

    await submitWith(ctx, { ok: true, story: makeStory('B') })

    expect(ctx.gen.story.value).toEqual(makeStory('B'))
    expect(ctx.gen.storyVersion.value).toBe(versionA + 1)
    expect(ctx.gen.formOpen.value).toBe(false)
  })

  // A6：替換成 B 時若不停止 A 的朗讀，裝置會繼續念 A 的句子；而且句子 id 只由頁碼與句序組成，
  // A 的 p0-s0 高亮會直接落在 B 第一頁第一句上，看起來像 B 的句子在念 A 的內容。
  //
  // 生成 B 期間刻意讓 A 繼續朗讀：B 還可能失敗，此時不該打斷正在讀 A 的使用者。
  it('A 正在朗讀時，B 生成中仍繼續朗讀，B 文字成功替換時停止朗讀並清除高亮', async () => {
    const ctx = await withStoryA()
    ctx.narration.toggle('p0-s0', 'A page 1.')

    const done = ctx.gen.submit()
    expect(ctx.narration.activeId.value).toBe('p0-s0')
    const cancelsBeforeReplace = ctx.engine.cancelCount
    ctx.respond({ ok: true, story: makeStory('B') })
    await done

    expect(ctx.gen.story.value).toEqual(makeStory('B'))
    expect(ctx.narration.activeId.value).toBeNull()
    expect(ctx.engine.cancelCount).toBeGreaterThan(cancelsBeforeReplace)
  })

  // A6 的另一半：B 失敗時 A 仍是目前的故事，正在念的 A 不該被打斷。
  it('A 正在朗讀時 B 文字失敗，A 的朗讀不受影響', async () => {
    const ctx = await withStoryA()
    ctx.narration.toggle('p0-s0', 'A page 1.')
    const cancelsBefore = ctx.engine.cancelCount

    await submitWith(ctx, fail('invalid_story'))

    expect(ctx.narration.activeId.value).toBe('p0-s0')
    expect(ctx.engine.cancelCount).toBe(cancelsBefore)
  })

  it('有故事時可以收起表單；沒有故事或生成中時不能收起', async () => {
    const empty = setup()
    empty.gen.closeForm()
    expect(empty.gen.formOpen.value).toBe(true)

    const ctx = await withStoryA()
    const done = ctx.gen.submit()
    ctx.gen.closeForm()
    expect(ctx.gen.formOpen.value).toBe(true)
    ctx.respond(fail('network_error'))
    await done

    ctx.gen.closeForm()
    expect(ctx.gen.formOpen.value).toBe(false)
  })
})
