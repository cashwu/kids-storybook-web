import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import type { Story } from '../../shared/story'
import type { GenerateSpeechResult, SpeechApi } from '../api/speechApi'
import { createFakeAudioPlayer } from '../speech/fakeAudioPlayer'
import { createFakeSpeechEngine, enUS } from '../speech/fakeSpeechEngine'
import { useNarration } from '../speech/useNarration'
import { useVoiceGeneration, useVoicePageRequests } from './useVoiceGeneration'

// OpenAI 語音的書本狀態（PLAN 3.8）。全部用假的語音 client，只能證明「何時送出哪一句的請求」與狀態轉換；
// 真實音質、等待時間與費用由真實 API 驗收確認。
const KEY = 'sk-test-fake0000'

function makeStory(name: string, pages = 4): Story {
  return {
    title: { en: name, zh: `故事 ${name}` },
    pages: Array.from({ length: pages }, (_, p) => ({
      sentences: [
        { en: `${name} p${p + 1} s1.`, zh: `${name} 第${p + 1}頁第1句。` },
        { en: `${name} p${p + 1} s2.`, zh: `${name} 第${p + 1}頁第2句。` },
      ],
    })),
  }
}

const OK = (): GenerateSpeechResult => ({ ok: true, audio: new Blob(['mp3'], { type: 'audio/mpeg' }) })

function setup(voices = [enUS]) {
  const pending: Array<{ text: string; language: string; resolve: (r: GenerateSpeechResult) => void }> = []
  const api: SpeechApi = {
    generateSpeech: vi.fn(
      (text, language) =>
        new Promise<GenerateSpeechResult>((resolve) => {
          pending.push({ text, language, resolve })
        }),
    ),
  }
  const created: string[] = []
  const revoked: string[] = []
  const urls = {
    create: () => {
      const url = `blob:${created.length + 1}`
      created.push(url)
      return url
    },
    revoke: (url: string) => revoked.push(url),
  }
  const locked = ref(false)
  const scope = effectScope()
  const narration = scope.run(() =>
    useNarration({ engine: createFakeSpeechEngine(voices), rate: 1, audio: createFakeAudioPlayer() }),
  )!
  const voice = useVoiceGeneration(api, narration, urls, () => locked.value)
  const texts = () => vi.mocked(api.generateSpeech).mock.calls.map(([text, language]) => `${language}:${text}`)
  /** 以文字找出請求並回應，讓測試能以任意順序結束請求。 */
  const respond = async (text: string, result: GenerateSpeechResult = OK()) => {
    const i = pending.findIndex((p) => p.text === text)
    expect(i).toBeGreaterThanOrEqual(0)
    pending.splice(i, 1)[0]!.resolve(result)
    await Promise.resolve()
    await Promise.resolve()
  }
  /** 已發佈一本 OpenAI 語音的書，第 1 頁英文已成功。 */
  async function publishAi(story = makeStory('A')) {
    const preparing = voice.prepare(story, KEY, 'openai')
    await respond(story.pages[0]!.sentences[0]!.en)
    await respond(story.pages[0]!.sentences[1]!.en)
    voice.publish(story, KEY, 'openai', await preparing)
    return story
  }
  return { api, voice, narration, locked, pending, texts, respond, created, revoked, publishAi, scope }
}

describe('useVoiceGeneration 新書第 1 頁', () => {
  it('裝置語音不送任何語音請求，narration 維持裝置語音（V1）', async () => {
    const { voice, texts, narration } = setup()
    const story = makeStory('A')

    const prepared = await voice.prepare(story, KEY, 'device')
    voice.publish(story, KEY, 'device', prepared)
    voice.ensurePage(voice.bookId.value, 1, 'en')

    expect(texts()).toEqual([])
    expect(voice.usesAi.value).toBe(false)
    expect(narration.aiVoice.value).toBe(false)
  })

  // 第 1 頁的結果先不放進目前這本書：等封面與語音都結束才一起發佈（PLAN 3.8「生成時機」）。
  it('OpenAI 語音只請求第 1 頁每句目前語言的語音，結果在 publish 後才出現', async () => {
    const { voice, texts, respond } = setup()
    const story = makeStory('A')

    const preparing = voice.prepare(story, KEY, 'openai')
    expect(texts()).toEqual(['en:A p1 s1.', 'en:A p1 s2.'])
    expect(voice.busy.value).toBe(true)
    await respond('A p1 s1.')
    await respond('A p1 s2.', { ok: false, error: 'timeout' })
    const prepared = await preparing
    expect(voice.clip(0, 0, 'en')).toBeUndefined()

    voice.publish(story, KEY, 'openai', prepared)

    expect(voice.busy.value).toBe(false)
    expect(voice.clip(0, 0, 'en')).toMatchObject({ status: 'ready', url: 'blob:1' })
    expect(voice.clip(0, 1, 'en')).toMatchObject({ status: 'failed', error: 'timeout' })
    expect(voice.usesAi.value).toBe(true)
  })

  // 中文時建立新故事 → 第 1 頁請求中文（V10）。
  it('目前朗讀語言是中文時，第 1 頁請求中文句子', async () => {
    const { voice, narration, texts, publishAi } = setup()
    await publishAi()
    narration.setLanguage('zh')

    void voice.prepare(makeStory('D'), KEY, 'openai')

    expect(texts().slice(-2)).toEqual(['zh:D 第1頁第1句。', 'zh:D 第1頁第2句。'])
  })
})

describe('useVoiceGeneration 逐頁請求', () => {
  it('進入新頁面時請求該頁每句；翻回或重播不再請求（V2、V3）', async () => {
    const { voice, texts, publishAi, respond } = setup()
    await publishAi()
    const book = voice.bookId.value

    voice.ensurePage(book, 1, 'en')
    expect(voice.clip(1, 0, 'en')?.status).toBe('pending')
    // 第 2 頁仍在生成時翻到第 3 頁：第 2 頁不取消，第 3 頁另外送出。
    voice.ensurePage(book, 2, 'en')
    await respond('A p2 s1.')
    voice.ensurePage(book, 1, 'en')
    voice.ensurePage(book, 0, 'en')

    expect(texts()).toEqual(['en:A p1 s1.', 'en:A p1 s2.', 'en:A p2 s1.', 'en:A p2 s2.', 'en:A p3 s1.', 'en:A p3 s2.'])
    expect(voice.clip(1, 0, 'en')?.status).toBe('ready')
  })

  it('所有頁都以英文翻過後，請求總數等於全書句數（V3，以 7 頁為例）', async () => {
    const { voice, api, publishAi } = setup()
    const story = await publishAi(makeStory('A', 7))
    for (const page of [1, 2, 3, 4, 5, 6, 3, 0]) voice.ensurePage(voice.bookId.value, page, 'en')

    expect(api.generateSpeech).toHaveBeenCalledTimes(story.pages.length * 2)
  })

  // 中英文各自請求、各自計費（PLAN 3.8「中文」、V10）。
  it('切到中文只請求目前頁的中文；切回英文已請求過的不再請求；兩種語言翻完總數為句數的兩倍', async () => {
    const { voice, api, texts, publishAi } = setup()
    await publishAi()
    const book = voice.bookId.value

    voice.ensurePage(book, 0, 'zh')
    expect(texts().slice(-2)).toEqual(['zh:A 第1頁第1句。', 'zh:A 第1頁第2句。'])
    voice.ensurePage(book, 1, 'zh')
    voice.ensurePage(book, 0, 'en')
    expect(api.generateSpeech).toHaveBeenCalledTimes(6)
    voice.ensurePage(book, 1, 'en')
    expect(texts().slice(-2)).toEqual(['en:A p2 s1.', 'en:A p2 s2.'])

    for (const page of [2, 3]) for (const lang of ['en', 'zh'] as const) voice.ensurePage(book, page, lang)
    expect(api.generateSpeech).toHaveBeenCalledTimes(16)
  })
})

describe('useVoiceGeneration 失敗、重試與出口', () => {
  it('單句失敗只影響該句，重試只重送那一句；不自動重試（V4）', async () => {
    const { voice, api, publishAi, respond } = setup()
    await publishAi()
    const book = voice.bookId.value
    voice.ensurePage(book, 1, 'en')
    await respond('A p2 s1.')
    await respond('A p2 s2.', { ok: false, error: 'timeout' })

    expect(voice.clip(1, 0, 'en')?.status).toBe('ready')
    expect(voice.clip(1, 1, 'en')).toMatchObject({ status: 'failed', error: 'timeout' })
    expect(api.generateSpeech).toHaveBeenCalledTimes(4)
    expect(voice.showExit.value).toBe(true)

    voice.ensurePage(book, 1, 'en')
    expect(api.generateSpeech).toHaveBeenCalledTimes(4)
    voice.retry(book, 1, 1, 'en')
    voice.retry(book, 1, 1, 'en')
    voice.retry(book, 1, 0, 'en')

    expect(api.generateSpeech).toHaveBeenCalledTimes(5)
    expect(vi.mocked(api.generateSpeech).mock.calls[4]?.[0]).toBe('A p2 s2.')
    expect(voice.clip(1, 1, 'en')?.status).toBe('pending')
  })

  // 出口（V5）：按下後中英文都用裝置語音，不再送任何語音請求、也不能重試；narration 跟著改回裝置語音。
  it('按「這本書改用裝置語音」後不再送語音請求，出口消失，narration 改回裝置語音', async () => {
    const { voice, api, narration, publishAi, respond } = setup()
    await publishAi()
    const book = voice.bookId.value
    voice.ensurePage(book, 1, 'zh')
    await respond('A 第2頁第1句。', { ok: false, error: 'insufficient_quota' })

    voice.exit()
    voice.ensurePage(book, 2, 'en')
    voice.retry(book, 1, 0, 'zh')

    expect(api.generateSpeech).toHaveBeenCalledTimes(4)
    expect(voice.usesAi.value).toBe(false)
    expect(voice.showExit.value).toBe(false)
    expect(narration.aiVoice.value).toBe(false)
  })

  it('沒有失敗時不顯示出口', async () => {
    const { voice, publishAi } = setup()
    await publishAi()

    expect(voice.showExit.value).toBe(false)
  })
})

describe('useVoiceGeneration 新舊故事隔離', () => {
  // 建立新故事期間舊書不送任何新請求（V7）：翻到未請求的頁、切語言或重試都不送；已有音檔照常可用。
  it('建立新故事期間不送新請求、不重試；已有音檔仍在', async () => {
    const { voice, api, locked, publishAi, respond } = setup()
    await publishAi()
    const book = voice.bookId.value
    voice.ensurePage(book, 1, 'en')
    await respond('A p2 s1.', { ok: false, error: 'timeout' })
    await respond('A p2 s2.')
    locked.value = true

    voice.ensurePage(book, 3, 'en')
    voice.ensurePage(book, 0, 'zh')
    voice.retry(book, 1, 0, 'en')

    expect(api.generateSpeech).toHaveBeenCalledTimes(4)
    expect(voice.clip(0, 0, 'en')?.status).toBe('ready')
    expect(voice.clip(3, 0, 'en')).toBeUndefined()
  })

  // 文字失敗後恢復時只補送目前所在頁、目前語言的句子（V7）：期間翻過的其他頁等再次進入才請求。
  it('鎖解除時，閱讀區的 watch 只補送目前頁、目前語言的句子', async () => {
    const { voice, api, narration, locked, publishAi, texts, scope } = setup()
    await publishAi()
    const page = ref(0)
    scope.run(() => useVoicePageRequests(voice, page, narration.language))
    locked.value = true
    page.value = 2
    await nextTick()
    page.value = 3
    await nextTick()
    expect(api.generateSpeech).toHaveBeenCalledTimes(2)

    locked.value = false
    await nextTick()

    expect(texts().slice(2)).toEqual(['en:A p4 s1.', 'en:A p4 s2.'])
  })

  // 替換故事時清除舊書音檔，舊書晚到的回應不會寫進新書（V7）：兩本書同一頁同一句的 key 相同，
  // 不以 bookId 擋下的話，舊書第 2 頁的音檔會出現在新書第 2 頁。
  it('publish 新書時 revoke 舊書音檔；舊書晚到的回應不寫進新書並被 revoke', async () => {
    const { voice, publishAi, respond, revoked, created } = setup()
    await publishAi(makeStory('A'))
    voice.ensurePage(voice.bookId.value, 1, 'en')

    const b = makeStory('B')
    const preparing = voice.prepare(b, KEY, 'openai')
    await respond('B p1 s1.')
    await respond('B p1 s2.')
    voice.publish(b, KEY, 'openai', await preparing)
    expect(revoked).toEqual(['blob:1', 'blob:2'])

    await respond('A p2 s1.')
    expect(voice.clip(1, 0, 'en')).toBeUndefined()
    expect(revoked).toContain(created.at(-1))
  })

  // 換書瞬間，舊閱讀區的 watch 可能在卸載前觸發；它記下的是舊書編號，不能替新書送請求。
  it('以舊書編號呼叫 ensurePage 或 retry 時忽略', async () => {
    const { voice, api, publishAi } = setup()
    await publishAi(makeStory('A'))
    const oldBook = voice.bookId.value
    await publishAi(makeStory('B'))
    const calls = vi.mocked(api.generateSpeech).mock.calls.length

    voice.ensurePage(oldBook, 3, 'en')
    voice.retry(oldBook, 0, 0, 'en')

    expect(api.generateSpeech).toHaveBeenCalledTimes(calls)
  })

  it('換成裝置語音的新書時，narration 改回裝置語音，且不再送語音請求', async () => {
    const { voice, api, narration, publishAi } = setup()
    await publishAi()
    const c = makeStory('C')

    voice.publish(c, KEY, 'device', await voice.prepare(c, KEY, 'device'))
    voice.ensurePage(voice.bookId.value, 1, 'en')

    expect(narration.aiVoice.value).toBe(false)
    expect(api.generateSpeech).toHaveBeenCalledTimes(2)
  })
})
