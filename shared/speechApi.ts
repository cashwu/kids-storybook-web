// 瀏覽器與 Worker 之間單句 OpenAI 語音 API 的請求／回應契約（PLAN 3.2、3.8）。
import type { StoryApiErrorCode } from './storyApi'

/**
 * POST，key 與其他 API 相同，只放在 `Authorization: Bearer <key>`（PLAN 3.2）。
 * body 只有一句文字與它的語言；聲音、語氣指示與語速由 Worker 決定，瀏覽器不能指定。
 */
export const SPEECH_API_PATH = '/api/speech'

/** en：英文句子；zh：繁體中文句子（PLAN 3.8「中文」）。 */
export type SpeechLanguage = 'en' | 'zh'

export interface SpeechRequestBody {
  text: string
  language: SpeechLanguage
}

/** 一句文字的上限（code point）。故事每句都是初學程度的短句，遠低於此；只用來擋下直接呼叫時的異常輸入。 */
export const SPEECH_TEXT_MAX = 500

/**
 * 成功時 Worker 把 OpenAI 回傳的 mp3 原樣串流給瀏覽器（content-type 為 audio/mpeg），不在 Worker 內讀完。
 * 錯誤類別沿用故事文字 API 的連線、key 與 OpenAI 錯誤類別，另加語音專屬的 invalid_audio。
 */
export type SpeechApiErrorCode =
  | Exclude<StoryApiErrorCode, 'story_refused' | 'invalid_story'>
  /** 成功回應不是可以播放的音檔（不是 audio 或內容是空的）。 */
  | 'invalid_audio'

const ERROR_CODES: Record<SpeechApiErrorCode, true> = {
  invalid_input: true,
  insecure_request: true,
  not_found: true,
  method_not_allowed: true,
  invalid_key: true,
  permission_denied: true,
  rate_limited: true,
  insufficient_quota: true,
  timeout: true,
  network_error: true,
  upstream_error: true,
  invalid_audio: true,
}

export function isSpeechApiErrorCode(value: unknown): value is SpeechApiErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CODES, value)
}

export interface SpeechErrorBody {
  error: SpeechApiErrorCode
}

/** Worker 等待 OpenAI 單句語音（含讀完 body）的上限（PLAN 3.8）。 */
export const WORKER_SPEECH_TIMEOUT_MS = 30_000
/** 瀏覽器等待 Worker 的上限：比 Worker 多 10 秒，讓 Worker 的逾時錯誤先回到前端（PLAN 3.8）。 */
export const BROWSER_SPEECH_TIMEOUT_MS = WORKER_SPEECH_TIMEOUT_MS + 10_000
