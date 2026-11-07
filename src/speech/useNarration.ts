import { computed, onScopeDispose, readonly, ref, type Ref } from 'vue'
import type { AudioPlayer } from './audioPlayer'
import type { SpeechEngine, VoiceInfo } from './engine'
import { pickEnglishVoice, pickTaiwanChineseVoice } from './voice'

export type NarrationAvailability =
  /** 聲音清單還沒載入（Chrome 首次 getVoices() 常回空陣列），暫時不能播放。 */
  | 'checking'
  | 'ready'
  /** 瀏覽器沒有 speechSynthesis。 */
  | 'unsupported'
  /** 聲音清單已載入但沒有英文聲音，或等候逾時仍是空清單。中文朗讀可能仍可用（見 chineseAvailable）。 */
  | 'no-english-voice'

export interface NarrationOptions {
  /** null 代表瀏覽器不支援 speechSynthesis。 */
  engine: SpeechEngine | null
  rate: number
  /** 聲音清單為空時，等 voiceschanged 的上限；逾時視為沒有英文聲音。 */
  voiceWaitMs?: number
  /** 播放 OpenAI 音檔用；null 或未提供時 playClip 不做任何事。 */
  audio?: AudioPlayer | null
}

export type NarrationLanguage = 'en' | 'zh'

/** toggle 收整句中英文，由 narration 依目前語言挑要念的文字，避免呼叫端傳錯語言。 */
export interface NarrationSentence {
  en: string
  zh: string
}

export interface Narration {
  availability: Readonly<Ref<NarrationAvailability>>
  /** 正在朗讀（高亮）的句子 id；同時最多一句。 */
  activeId: Readonly<Ref<string | null>>
  /** 以目前語言播放該句；若該句正在朗讀則停止（暫停）。目前語言無法朗讀時不做任何事。 */
  toggle(id: string, sentence: NarrationSentence): void
  /** 停止目前朗讀並清除高亮，例如切頁時。 */
  stop(): void
  /** 本次朗讀語言；只在當頁記憶體。 */
  language: Readonly<Ref<NarrationLanguage>>
  /** 裝置有 zh-TW 聲音；false 時不能切到中文。聲音清單載入前也是 false。 */
  chineseAvailable: Readonly<Ref<boolean>>
  /** 目前語言能否播放。 */
  canPlay: Readonly<Ref<boolean>>
  /** 切換朗讀語言並停止目前朗讀；選同一語言或沒有 zh-TW 時選中文不做任何事。 */
  setLanguage(language: NarrationLanguage): void
  /** 目前這本書用 OpenAI 語音（PLAN 3.8）；只影響語言規則，實際播放由呼叫端選 toggle 或 playClip。 */
  aiVoice: Readonly<Ref<boolean>>
  /** 換書或按下「這本書改用裝置語音」時設定；值改變時停止目前朗讀。 */
  setAiVoice(on: boolean): void
  /** 能否切到中文：裝置有 zh-TW 聲音，或這本書用 OpenAI 語音。 */
  canSelectChinese: Readonly<Ref<boolean>>
  /** 播放該句的 OpenAI 音檔；若該句正在播放則停止。與 toggle 共用「同時只播一句」與高亮。 */
  playClip(id: string, src: string): void
}

const DEFAULT_VOICE_WAIT_MS = 2000

const SPEAK_LANG: Record<NarrationLanguage, string> = { en: 'en-US', zh: 'zh-TW' }

/**
 * 逐句朗讀的狀態（PLAN 3.3、3.4、3.5 第 3 項、3.7）。
 *
 * 必須維持的條件：
 * - 同時只播一句：每次 speak 前先 cancel，否則 speechSynthesis 會把新句排在舊句後面。
 * - 高亮只由「目前這句」的 end／error 清除：瀏覽器在 cancel 後才非同步送出被取消那句的事件，
 *   因此每次播放配一個遞增的 token，事件的 token 不是最新的就忽略。
 * - 暫停 = 停止這句並清除高亮，再按從句首重播；不用 speechSynthesis.pause()，
 *   它在 Android Chrome 等裝置上不可靠，且每句很短，重播成本低。
 * - 按下播放就高亮，不等 utterance 的 start 事件，讓暫停鈕立即可用；高亮由 end／error 清除。
 * - 單句出錯只清除高亮、回到可播放，不自動重念。
 * - 朗讀語言：預設英文，切換時停止目前朗讀；中文只用 zh-TW 聲音，沒有就不能切換。
 *   stop() 不重設語言，App 層共用這一份狀態，替換故事後仍沿用（重新整理才回到英文）。
 *   聲音清單變動時，只有「目前語言」的聲音消失才停止朗讀；zh-TW 消失時回到英文。
 * - OpenAI 語音的書（aiVoice，PLAN 3.8）：音檔以 audio player 播放，與 speechSynthesis 共用同一個 token 與高亮，
 *   換句、stop() 都同時停掉兩者，確保同時只播一句。這本書的中文不靠裝置聲音，沒有 zh-TW 也能選中文，
 *   聲音清單變動也不影響語言與播放中的音檔；改回裝置語音時才套回上面的 zh-TW 規則。
 */
export function useNarration(options: NarrationOptions): Narration {
  const { engine, rate } = options
  const audio = options.audio ?? null
  /** 英文聲音的狀態；中文是否可用另由 chineseAvailable 表示。 */
  const availability = ref<NarrationAvailability>(engine ? 'checking' : 'unsupported')
  const activeId = ref<string | null>(null)
  const language = ref<NarrationLanguage>('en')
  const chineseAvailable = ref(false)
  const aiVoice = ref(false)
  const voices: Record<NarrationLanguage, VoiceInfo | null> = { en: null, zh: null }
  let token = 0
  let waitTimer: ReturnType<typeof setTimeout> | undefined

  const canSelectChinese = computed(() => aiVoice.value || chineseAvailable.value)

  const canPlay = computed(() =>
    language.value === 'zh' ? chineseAvailable.value : availability.value === 'ready',
  )

  function clearActive() {
    token += 1
    activeId.value = null
  }

  function stop() {
    engine?.cancel()
    audio?.stop()
    clearActive()
  }

  /** 沒有 zh-TW 聲音時離開中文；OpenAI 語音的書例外（中文不靠裝置聲音）。 */
  function fallBackFromChinese() {
    if (!aiVoice.value && language.value === 'zh' && !voices.zh) language.value = 'en'
  }

  function evaluateVoices(): void {
    if (!engine) return
    const list = engine.getVoices()
    voices.en = pickEnglishVoice(list)
    voices.zh = pickTaiwanChineseVoice(list)
    chineseAvailable.value = voices.zh !== null

    if (voices.en) {
      clearTimeout(waitTimer)
      availability.value = 'ready'
    } else if (list.length === 0 && waitTimer !== undefined && availability.value === 'checking') {
      // 空清單可能只是還沒載入：等待期間維持 checking，逾時後才判定沒有英文聲音。
    } else {
      availability.value = 'no-english-voice'
    }

    if (!aiVoice.value && !voices[language.value] && activeId.value !== null) stop()
    fallBackFromChinese()
  }

  function setLanguage(next: NarrationLanguage) {
    if (next === language.value) return
    if (next === 'zh' && !canSelectChinese.value) return
    stop()
    language.value = next
  }

  function toggle(id: string, sentence: NarrationSentence) {
    const voice = voices[language.value]
    if (!engine || !canPlay.value || !voice) return
    if (activeId.value === id) {
      stop()
      return
    }
    engine.cancel()
    token += 1
    const mine = token
    activeId.value = id
    const finish = () => {
      if (mine === token) clearActive()
    }
    engine.speak(
      { text: sentence[language.value], lang: SPEAK_LANG[language.value], rate, voice },
      { onEnd: finish, onError: finish },
    )
  }

  function setAiVoice(on: boolean) {
    if (on === aiVoice.value) return
    stop()
    aiVoice.value = on
    fallBackFromChinese()
  }

  function playClip(id: string, src: string) {
    if (!audio) return
    if (activeId.value === id) {
      stop()
      return
    }
    engine?.cancel()
    audio.stop()
    token += 1
    const mine = token
    activeId.value = id
    const finish = () => {
      if (mine === token) clearActive()
    }
    audio.play(src, { onEnd: finish, onError: finish })
  }

  // 沒有 speechSynthesis 時也要在 scope 結束時停掉音檔。
  onScopeDispose(() => audio?.stop())

  if (engine) {
    const unsubscribe = engine.onVoicesChanged(evaluateVoices)
    if (engine.getVoices().length === 0) {
      // 逾時時重新讀一次清單：有些瀏覽器不送 voiceschanged，但清單會在等候期間悄悄載入。
      waitTimer = setTimeout(() => {
        waitTimer = undefined
        evaluateVoices()
      }, options.voiceWaitMs ?? DEFAULT_VOICE_WAIT_MS)
    } else {
      evaluateVoices()
    }
    onScopeDispose(() => {
      clearTimeout(waitTimer)
      unsubscribe()
      stop()
    })
  }

  return {
    availability: readonly(availability),
    activeId: readonly(activeId),
    toggle,
    stop,
    language: readonly(language),
    chineseAvailable: readonly(chineseAvailable),
    canPlay,
    setLanguage,
    aiVoice: readonly(aiVoice),
    setAiVoice,
    canSelectChinese,
    playClip,
  }
}
