import type { SpeakEvents, SpeakRequest, SpeechEngine, VoiceInfo } from './engine'

// 測試用的假 speechSynthesis：記錄每次 speak／cancel，事件由測試手動觸發。
// 刻意不在 cancel() 時自動觸發被取消那句的 end／error：真實瀏覽器會在 cancel 之後「非同步」
// 送出舊句的事件（可能晚於下一句開始），測試要能自行決定舊事件抵達的時間點。
export interface SpokenUtterance {
  request: SpeakRequest
  events: SpeakEvents
  /** speak 當下累計的 cancel 次數，用來確認換句時 cancel 發生在 speak 之前。 */
  cancelCountAtSpeak: number
}

export interface FakeSpeechEngine extends SpeechEngine {
  voices: VoiceInfo[]
  spoken: SpokenUtterance[]
  cancelCount: number
  listenerCount(): number
  emitVoicesChanged(): void
}

export function createFakeSpeechEngine(voices: VoiceInfo[] = []): FakeSpeechEngine {
  const listeners = new Set<() => void>()
  const fake: FakeSpeechEngine = {
    voices,
    spoken: [],
    cancelCount: 0,
    getVoices: () => fake.voices,
    onVoicesChanged(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    speak(request, events) {
      fake.spoken.push({ request, events, cancelCountAtSpeak: fake.cancelCount })
    },
    cancel() {
      fake.cancelCount += 1
    },
    listenerCount: () => listeners.size,
    emitVoicesChanged() {
      for (const listener of [...listeners]) listener()
    },
  }
  return fake
}

export const enUS: VoiceInfo = { name: 'Samantha', lang: 'en-US', default: false }
export const zhTW: VoiceInfo = { name: 'Meijia', lang: 'zh-TW', default: true }
