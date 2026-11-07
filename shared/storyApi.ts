// 瀏覽器與 Worker 之間故事文字 API 的請求／回應契約（PLAN 3.2、3.3、3.7）。
import type { Story } from './story'
import type { StoryInputField } from './storyInput'

/**
 * POST，key 只放在 `Authorization: Bearer <key>`；body 只有角色、情境與頁數。
 * key 不可放進 body、query 或自訂 header：Cloudflare 的 log 只遮蔽 Authorization（PLAN 3.2）。
 */
export const STORY_API_PATH = '/api/story'

export interface StoryRequestBody {
  character: string
  situation: string
  /** 4–10 的整數，規則見 shared/storyInput.ts。 */
  pageCount: number
}

export interface StorySuccessBody {
  story: Story
}

/**
 * 本 app 定義的錯誤類別。Worker 只回這些代碼，不轉送 OpenAI 的錯誤訊息原文，
 * 因為 OpenAI 的 401 訊息會帶回 key 的開頭與末 4 碼。
 */
export type StoryApiErrorCode =
  /** 角色、情境或 key 不合格；fields 指出需要修正的欄位。 */
  | 'invalid_input'
  /** 以 http 呼叫 API；不轉送 OpenAI，避免 key 以明文經過網路。 */
  | 'insecure_request'
  | 'not_found'
  | 'method_not_allowed'
  /** OpenAI 回 401：key 無效。 */
  | 'invalid_key'
  /** OpenAI 回 403：key 沒有使用該模型或功能的權限。 */
  | 'permission_denied'
  /** OpenAI 回 429：請求太頻繁。 */
  | 'rate_limited'
  /** OpenAI 回 429 且錯誤代碼為 insufficient_quota：額度不足或未設定付款。 */
  | 'insufficient_quota'
  /** 等待 OpenAI（Worker）或等待 Worker（瀏覽器）超過時限。OpenAI 可能仍已處理並計費。 */
  | 'timeout'
  /** 連不上 OpenAI 或 Worker。 */
  | 'network_error'
  /** OpenAI 的其他錯誤（5xx 或非預期的 4xx），或回應無法解讀。 */
  | 'upstream_error'
  /** 模型拒絕產生這個故事。 */
  | 'story_refused'
  /** 模型輸出不符合所選頁數的雙語格式，沒有採用。 */
  | 'invalid_story'

// Record 讓新增錯誤類別時一定要同步這份清單，前端才不會把新的代碼誤判成未知錯誤。
const ERROR_CODES: Record<StoryApiErrorCode, true> = {
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
  story_refused: true,
  invalid_story: true,
}

export function isStoryApiErrorCode(value: unknown): value is StoryApiErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CODES, value)
}

export interface StoryErrorBody {
  error: StoryApiErrorCode
  fields?: StoryInputField[]
}

/** Worker 等待 OpenAI 文字回應的上限（PLAN 3.7）。 */
export const WORKER_TEXT_TIMEOUT_MS = 60_000
/** 瀏覽器等待 Worker 的上限：比 Worker 多 10 秒，讓 Worker 的逾時錯誤先回到前端（PLAN 3.7）。 */
export const BROWSER_TEXT_TIMEOUT_MS = WORKER_TEXT_TIMEOUT_MS + 10_000
