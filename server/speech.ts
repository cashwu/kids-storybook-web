// 單句 OpenAI 語音：檢查瀏覽器送來的句子、組出 /v1/audio/speech 的請求，並把錯誤轉成本 app 的類別（PLAN 3.8）。
import { SPEECH_TEXT_MAX, type SpeechApiErrorCode, type SpeechLanguage } from '../shared/speechApi'
import { mapOpenAIError } from './storyText'

export const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech'

// 模型、聲音、語速與各語言的語氣指示是部署設定，不是使用者選單（PLAN 3.8「模型與期限」）；
// 預設值由使用者 2026-11-07 試聽後確認，修改前要重新試聽。
export const SPEECH_MODEL = 'gpt-4o-mini-tts'
export const SPEECH_VOICE = 'sage'
// 放慢交給語氣指示：speed 0.85 試聽時句尾有不自然的拖音（PLAN 第 5 節）。
export const SPEECH_SPEED = 1

const INSTRUCTIONS: Record<SpeechLanguage, string> = {
  en: 'You are reading a picture book aloud to a 4-5 year old child who is just beginning to learn English. Speak gently, warmly and slowly, with clear pronunciation and short natural pauses.',
  // 最後一句是為了改善試聽時中文開頭偏小聲的問題（PLAN 第 5 節）。
  zh: 'You are reading a picture book aloud to a 4-5 year old child in Taiwan. Speak Mandarin Chinese with a natural Taiwanese accent (台灣國語), gently, warmly and slowly, with clear pronunciation and short natural pauses. Start at a clear, normal speaking volume from the very first word and keep the volume steady throughout.',
}

export interface SpeechInput {
  text: string
  language: SpeechLanguage
}

/**
 * 語音 API 可被直接呼叫，不信任 body：只接受 en／zh 與去除頭尾空白後 1–500 字元（code point）的文字，
 * 不合格回 null，呼叫端不轉送 OpenAI（每次轉送都由使用者的 key 計費）。
 */
export function parseSpeechBody(body: unknown): SpeechInput | null {
  if (typeof body !== 'object' || body === null) return null
  const { text, language } = body as Record<string, unknown>
  if (language !== 'en' && language !== 'zh') return null
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  const length = [...trimmed].length
  if (length === 0 || length > SPEECH_TEXT_MAX) return null
  return { text: trimmed, language }
}

/**
 * 句子只放在 input、語氣指示由 Worker 依語言決定：句子來自先前的模型輸出，也可能被直接呼叫的人改寫，
 * 不讓它影響聲音、語速或語氣設定。
 */
export function buildSpeechRequest(input: SpeechInput) {
  return {
    model: SPEECH_MODEL,
    voice: SPEECH_VOICE,
    input: input.text,
    instructions: INSTRUCTIONS[input.language],
    response_format: 'mp3',
    speed: SPEECH_SPEED,
  }
}

/**
 * 沿用故事文字 API 的對應（只讀 OpenAI 錯誤的 `code`，不讀含 key 片段的 `message`）。
 * 語音沒有「拒絕」或格式驗證的類別，mapOpenAIError 不會回故事專屬類別；這裡收斂型別以防日後擴充時漏改。
 */
export function mapSpeechError(status: number, body: unknown): SpeechApiErrorCode {
  const mapped = mapOpenAIError(status, body)
  return mapped === 'story_refused' || mapped === 'invalid_story' ? 'upstream_error' : mapped
}
