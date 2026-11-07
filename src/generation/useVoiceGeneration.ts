import { computed, reactive, readonly, ref, watch, type Ref } from 'vue'
import type { SpeechApiErrorCode, SpeechLanguage } from '../../shared/speechApi'
import type { Story } from '../../shared/story'
import type { SpeechApi } from '../api/speechApi'
import type { NarrationLanguage } from '../speech/useNarration'

/** 生成表單的「朗讀方式」（PLAN 3.8「選擇」）。 */
export type VoiceMode = 'device' | 'openai'

export type ClipStatus = 'pending' | 'ready' | 'failed'

export interface Clip {
  status: ClipStatus
  /** 成功時的 object URL（音檔只在當頁記憶體）。 */
  url: string | null
  error: SpeechApiErrorCode | null
}

/** 尚未發佈的新書第 1 頁語音結果，由 publish 與文字一起換上。 */
export interface PreparedClips {
  clips: Map<string, Clip>
}

export interface ObjectUrls {
  create(blob: Blob): string
  revoke(url: string): void
}

export interface VoiceGeneration {
  /** 目前這本書的編號；閱讀區記下建立時的編號，換書後舊閱讀區的請求會被忽略。 */
  bookId: Readonly<Ref<number>>
  /** 這本書選了 OpenAI 語音且還沒按「改用裝置語音」。 */
  usesAi: Readonly<Ref<boolean>>
  /** 任一句語音請求進行中：這段時間不能送出新故事（PLAN 3.8「隔離」）。 */
  busy: Readonly<Ref<boolean>>
  /** 這本書有句子失敗，且仍在用 OpenAI 語音：顯示「這本書改用裝置語音」。 */
  showExit: Readonly<Ref<boolean>>
  /** 建立新故事期間：不送任何新的語音請求。 */
  locked: Readonly<Ref<boolean>>
  clip(page: number, sentence: number, language: NarrationLanguage): Clip | undefined
  /** 為尚未發佈的新故事請求第 1 頁目前語言的語音；裝置語音回 null。不改變目前這本書。 */
  prepare(story: Story, apiKey: string, mode: VoiceMode): Promise<PreparedClips | null>
  /** 新書發佈：清除舊書的音檔，換成新書的狀態。 */
  publish(story: Story, apiKey: string, mode: VoiceMode, prepared: PreparedClips | null): void
  /** 進入頁面或切換語言時呼叫：請求該頁目前語言尚未請求過的句子。 */
  ensurePage(book: number, page: number, language: NarrationLanguage): void
  /** 手動重試失敗的一句。 */
  retry(book: number, page: number, sentence: number, language: NarrationLanguage): void
  /** 「這本書改用裝置語音」。 */
  exit(): void
}

export const clipKey = (page: number, sentence: number, language: NarrationLanguage) => `${page}-${sentence}-${language}`

/**
 * OpenAI 語音的書本狀態（PLAN 3.8、V2–V10）。
 *
 * 必須維持的條件：
 * - 音檔以「頁＋句＋語言」為單位，每個單位只自動請求一次；成功的音檔留在當頁記憶體，重播、翻回與切回語言都不再請求。
 *   只有 retry 會重送，且只重送失敗的那句；不自動重試、不自動改用裝置語音。
 * - 新書第 1 頁由 prepare 請求、結果先不放進目前這本書，publish 時才與文字一起換上（同封面）。
 * - 建立新故事期間（locked）舊書不送任何新請求；locked 解除時由閱讀區的 watch 補送目前頁、目前語言的句子。
 * - 新舊故事隔離：publish 清掉並 revoke 舊書的音檔；請求記下送出時的 bookId，換書後晚到的結果直接丟棄，
 *   不會寫進新書。閱讀區也以 bookId 呼叫 ensurePage／retry，換書瞬間舊閱讀區的 watch 不會替新書送請求。
 * - 按下出口後這本書不再送任何語音請求，narration 改回裝置語音（含 zh-TW 規則）。
 *
 * key 只為了逐頁請求與手動重試保留在這個閉包（當頁記憶體），不寫入故事資料、URL 或瀏覽器儲存（PLAN 3.2）。
 */
export function useVoiceGeneration(
  api: SpeechApi,
  narration: { language: Readonly<Ref<NarrationLanguage>>; setAiVoice(on: boolean): void },
  urls: ObjectUrls,
  isLocked: () => boolean,
): VoiceGeneration {
  const bookId = ref(0)
  const enabled = ref(false)
  const exited = ref(false)
  const clips = reactive(new Map<string, Clip>())
  const inFlight = ref(0)
  const locked = computed(isLocked)
  let current: { story: Story; apiKey: string } | null = null

  const usesAi = computed(() => enabled.value && !exited.value)
  const hasFailure = computed(() => [...clips.values()].some((c) => c.status === 'failed'))

  async function fetchClip(story: Story, apiKey: string, page: number, sentence: number, language: SpeechLanguage): Promise<Clip> {
    const text = story.pages[page]!.sentences[sentence]![language]
    inFlight.value += 1
    try {
      const result = await api.generateSpeech(text, language, apiKey)
      return result.ok
        ? { status: 'ready', url: urls.create(result.audio), error: null }
        : { status: 'failed', url: null, error: result.error }
    } finally {
      inFlight.value -= 1
    }
  }

  function request(page: number, sentence: number, language: NarrationLanguage) {
    if (!current) return
    const book = bookId.value
    const key = clipKey(page, sentence, language)
    clips.set(key, { status: 'pending', url: null, error: null })
    void fetchClip(current.story, current.apiKey, page, sentence, language).then((clip) => {
      if (book !== bookId.value) {
        if (clip.url) urls.revoke(clip.url)
        return
      }
      clips.set(key, clip)
    })
  }

  function canRequest(book: number) {
    return book === bookId.value && usesAi.value && !locked.value && current !== null
  }

  return {
    bookId: readonly(bookId),
    usesAi,
    busy: computed(() => inFlight.value > 0),
    showExit: computed(() => usesAi.value && hasFailure.value),
    locked,
    clip: (page, sentence, language) => clips.get(clipKey(page, sentence, language)),
    async prepare(story, apiKey, mode) {
      if (mode !== 'openai') return null
      const language = narration.language.value
      const first = story.pages[0]!
      const results = await Promise.all(first.sentences.map((_, s) => fetchClip(story, apiKey, 0, s, language)))
      return { clips: new Map(results.map((clip, s) => [clipKey(0, s, language), clip])) }
    },
    publish(story, apiKey, mode, prepared) {
      for (const clip of clips.values()) if (clip.url) urls.revoke(clip.url)
      clips.clear()
      bookId.value += 1
      current = { story, apiKey }
      enabled.value = mode === 'openai'
      exited.value = false
      if (enabled.value && prepared) for (const [key, clip] of prepared.clips) clips.set(key, clip)
      narration.setAiVoice(enabled.value)
    },
    ensurePage(book, page, language) {
      if (!canRequest(book)) return
      const sentences = current!.story.pages[page]?.sentences ?? []
      sentences.forEach((_, s) => {
        if (!clips.has(clipKey(page, s, language))) request(page, s, language)
      })
    },
    retry(book, page, sentence, language) {
      if (!canRequest(book)) return
      if (clips.get(clipKey(page, sentence, language))?.status !== 'failed') return
      request(page, sentence, language)
    },
    exit() {
      if (!usesAi.value) return
      exited.value = true
      narration.setAiVoice(false)
    },
  }
}

/**
 * 閱讀區用：進入頁面、切換語言、或建立新故事的鎖解除時，補送目前頁、目前語言尚未請求的句子（PLAN 3.8「生成時機」「隔離」）。
 * book 在閱讀區建立時記下；換書後舊閱讀區的 watch 即使觸發也不會替新書送請求。
 */
export function useVoicePageRequests(
  voice: Pick<VoiceGeneration, 'bookId' | 'locked' | 'ensurePage'>,
  pageIndex: Readonly<Ref<number>>,
  language: Readonly<Ref<NarrationLanguage>>,
) {
  const book = voice.bookId.value
  watch(
    [pageIndex, language, voice.locked],
    ([page, lang]) => voice.ensurePage(book, page, lang),
    { immediate: true },
  )
  return book
}
