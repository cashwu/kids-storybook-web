// 瀏覽器與 Worker 之間單張封面 API 的請求／回應契約（PLAN 3.2、3.3、3.6、3.7）。
import type { Story } from './story'
import type { StoryApiErrorCode } from './storyApi'

/**
 * POST，key 與故事文字 API 相同，只放在 `Authorization: Bearer <key>`（PLAN 3.2）。
 * body 只有已通過驗證的故事；Worker 會再驗證一次，不合格不轉送 OpenAI。
 */
export const COVER_API_PATH = '/api/cover'

export interface CoverRequestBody {
  story: Story
}

/**
 * 成功時 Worker 把 OpenAI Images API 的回應原樣串流轉送，不在 Worker 內解碼（PLAN 3.7：
 * 約 1.5 MB 的 base64 JSON，Free 方案每請求只有 10 ms CPU）。瀏覽器只讀 `data[0].b64_json`。
 */
export interface CoverSuccessBody {
  data: Array<{ b64_json: string }>
}

/**
 * 封面 API 的錯誤類別：沿用故事文字 API 的連線、key 與 OpenAI 錯誤類別，另加封面專屬的兩類。
 * 故事專屬的 story_refused／invalid_story 不會出現在封面 API。
 */
export type CoverApiErrorCode =
  | Exclude<StoryApiErrorCode, 'story_refused' | 'invalid_story'>
  /** OpenAI 的安全系統拒絕產生這張圖（400 `moderation_blocked`）。 */
  | 'cover_refused'
  /** 成功回應裡沒有可顯示的 GIF。 */
  | 'invalid_cover'

const ERROR_CODES: Record<CoverApiErrorCode, true> = {
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
  cover_refused: true,
  invalid_cover: true,
}

export function isCoverApiErrorCode(value: unknown): value is CoverApiErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CODES, value)
}

export interface CoverErrorBody {
  error: CoverApiErrorCode
}

/** Worker 等待 OpenAI 封面回應（含讀完 body）的上限（PLAN 3.7）。 */
export const WORKER_COVER_TIMEOUT_MS = 120_000
/** 瀏覽器等待 Worker 的上限：比 Worker 多 10 秒，讓 Worker 的逾時錯誤先回到前端（PLAN 3.7）。 */
export const BROWSER_COVER_TIMEOUT_MS = WORKER_COVER_TIMEOUT_MS + 10_000
