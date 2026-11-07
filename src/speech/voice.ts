import type { VoiceInfo } from './engine'

// 朗讀的聲音與語速規則（PLAN 3.7）：不提供使用者選單，聲音依裝置挑選，語速由建置設定決定。

/** lang 正規化成小寫、以 `-` 分隔（Android 會回報 `en_US` 這類格式）。 */
function normalizeLang(lang: string): string {
  return lang.trim().replace(/_/g, '-').toLowerCase()
}

function isEnglish(voice: VoiceInfo): boolean {
  const lang = normalizeLang(voice.lang)
  return lang === 'en' || lang.startsWith('en-')
}

function isEnUS(voice: VoiceInfo): boolean {
  return normalizeLang(voice.lang) === 'en-us'
}

/**
 * 依序選：標為預設的 en-US 聲音 → 第一個 en-US 聲音 → 任一 en-* 聲音；都沒有時回傳 null，
 * 由呼叫端停用播放。瀏覽器的 `default` 只標示一個聲音（常是系統語言），不能只靠它找英文聲音。
 */
export function pickEnglishVoice<V extends VoiceInfo>(voices: readonly V[]): V | null {
  return (
    voices.find((v) => v.default && isEnUS(v)) ??
    voices.find(isEnUS) ??
    voices.find(isEnglish) ??
    null
  )
}

export const DEFAULT_SPEECH_RATE = 0.1
const MIN_RATE = 0.1
const MAX_RATE = 10

/**
 * 解析建置設定 `VITE_SPEECH_RATE`。未設定、不是數字或超出 speechSynthesis 的 0.1–10 範圍時
 * 用預設值，避免把無效值交給瀏覽器（各瀏覽器對無效 rate 的處理不同，有的直接丟例外）。
 */
export function parseSpeechRate(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_SPEECH_RATE
  const rate = Number(raw)
  if (!Number.isFinite(rate) || rate < MIN_RATE || rate > MAX_RATE) return DEFAULT_SPEECH_RATE
  return rate
}
