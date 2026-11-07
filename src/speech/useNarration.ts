import { onScopeDispose, readonly, ref, type Ref } from 'vue'
import type { SpeechEngine, VoiceInfo } from './engine'
import { pickEnglishVoice } from './voice'

export type NarrationAvailability =
  /** 聲音清單還沒載入（Chrome 首次 getVoices() 常回空陣列），暫時不能播放。 */
  | 'checking'
  | 'ready'
  /** 瀏覽器沒有 speechSynthesis。 */
  | 'unsupported'
  /** 聲音清單已載入但沒有英文聲音，或等候逾時仍是空清單。 */
  | 'no-english-voice'

export interface NarrationOptions {
  /** null 代表瀏覽器不支援 speechSynthesis。 */
  engine: SpeechEngine | null
  rate: number
  /** 聲音清單為空時，等 voiceschanged 的上限；逾時視為沒有英文聲音。 */
  voiceWaitMs?: number
}

export interface Narration {
  availability: Readonly<Ref<NarrationAvailability>>
  /** 正在朗讀（高亮）的句子 id；同時最多一句。 */
  activeId: Readonly<Ref<string | null>>
  /** 播放該句；若該句正在朗讀則停止（暫停）。裝置無法朗讀時不做任何事。 */
  toggle(id: string, text: string): void
  /** 停止目前朗讀並清除高亮，例如切頁時。 */
  stop(): void
}

const DEFAULT_VOICE_WAIT_MS = 2000

/**
 * 逐句英文朗讀的狀態（PLAN 3.3、3.4、3.7）。
 *
 * 必須維持的條件：
 * - 同時只播一句：每次 speak 前先 cancel，否則 speechSynthesis 會把新句排在舊句後面。
 * - 高亮只由「目前這句」的 end／error 清除：瀏覽器在 cancel 後才非同步送出被取消那句的事件，
 *   因此每次播放配一個遞增的 token，事件的 token 不是最新的就忽略。
 * - 暫停 = 停止這句並清除高亮，再按從句首重播；不用 speechSynthesis.pause()，
 *   它在 Android Chrome 等裝置上不可靠，且每句很短，重播成本低。
 * - 按下播放就高亮，不等 utterance 的 start 事件，讓暫停鈕立即可用；高亮由 end／error 清除。
 * - 單句出錯只清除高亮、回到可播放，不自動重念。
 */
export function useNarration(options: NarrationOptions): Narration {
  const { engine, rate } = options
  const availability = ref<NarrationAvailability>(engine ? 'checking' : 'unsupported')
  const activeId = ref<string | null>(null)
  let voice: VoiceInfo | null = null
  let token = 0
  let waitTimer: ReturnType<typeof setTimeout> | undefined

  function clearActive() {
    token += 1
    activeId.value = null
  }

  function stop() {
    if (!engine) return
    engine.cancel()
    clearActive()
  }

  function evaluateVoices(): void {
    if (!engine) return
    const voices = engine.getVoices()
    voice = pickEnglishVoice(voices)
    if (voice) {
      clearTimeout(waitTimer)
      availability.value = 'ready'
      return
    }
    // 空清單可能只是還沒載入：等待期間維持 checking，逾時後才判定沒有英文聲音。
    if (voices.length === 0 && waitTimer !== undefined && availability.value === 'checking') return
    if (activeId.value !== null) stop()
    availability.value = 'no-english-voice'
  }

  function toggle(id: string, text: string) {
    if (!engine || availability.value !== 'ready' || !voice) return
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
    engine.speak({ text, lang: 'en-US', rate, voice }, { onEnd: finish, onError: finish })
  }

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

  return { availability: readonly(availability), activeId: readonly(activeId), toggle, stop }
}
