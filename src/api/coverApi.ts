// 瀏覽器呼叫同網域 Worker 單張封面 API 的 client（PLAN 3.2、3.3、3.7）。
import {
  BROWSER_COVER_TIMEOUT_MS,
  COVER_API_PATH,
  isCoverApiErrorCode,
  type CoverApiErrorCode,
  type CoverRequestBody,
} from '../../shared/coverApi'
import type { Story } from '../../shared/story'

export type GenerateCoverResult =
  | { ok: true; src: string }
  | { ok: false; error: CoverApiErrorCode }

export interface CoverApi {
  generateCover(story: Story, apiKey: string): Promise<GenerateCoverResult>
}

export interface CoverApiDeps {
  fetch: typeof fetch
  /** 測試注入可手動觸發的 signal，不以真實等待驗證逾時。 */
  timeoutSignal: (ms: number) => AbortSignal
}

/** PNG 檔頭（89 50 4E 47 0D 0A 1A 0A）以 base64 編碼後的開頭。 */
const PNG_BASE64_PREFIX = 'iVBORw0KGgo'

/** 只接受本 app 定義的錯誤類別；其他內容（例如代理回的 HTML）一律視為 upstream_error。 */
function parseError(text: string): GenerateCoverResult {
  let error: unknown
  try {
    error = (JSON.parse(text) as { error?: unknown } | null)?.error
  } catch {
    error = undefined
  }
  return { ok: false, error: isCoverApiErrorCode(error) ? error : 'upstream_error' }
}

/**
 * 從 Worker 原樣轉送的 OpenAI 回應取出 PNG。只接受 PNG 檔頭，其他內容當成 invalid_cover：
 * 畫面以 `<img>` 顯示，不會執行內容，但其他格式與 data URL 宣告的 `image/png` 不符，可能顯示成破圖。
 */
function parseCover(text: string): GenerateCoverResult {
  let b64: unknown
  try {
    b64 = (JSON.parse(text) as { data?: Array<{ b64_json?: unknown }> } | null)?.data?.[0]?.b64_json
  } catch {
    b64 = undefined
  }
  if (typeof b64 !== 'string' || !b64.startsWith(PNG_BASE64_PREFIX)) return { ok: false, error: 'invalid_cover' }
  return { ok: true, src: `data:image/png;base64,${b64}` }
}

/**
 * 每次呼叫只送一次請求，不自動重試（PLAN 3.3）；逾時或網路錯誤一律結束為失敗，由使用者手動重試封面。
 * key 只放在 Authorization header，不放進 URL、body 或自訂 header（PLAN 3.2）。
 *
 * 逾時 signal 同時涵蓋等待回應與讀完 body：封面是 base64 圖片 JSON、body 較大，可能在讀 body 途中逾時。
 * Worker 自己逾時而中斷串流時，瀏覽器讀 body 失敗、signal 尚未觸發，結束為 network_error；
 * 截斷的內容不會被解析成封面。
 */
export function createCoverApi(deps: CoverApiDeps): CoverApi {
  return {
    async generateCover(story, apiKey) {
      const body: CoverRequestBody = { story }
      const signal = deps.timeoutSignal(BROWSER_COVER_TIMEOUT_MS)
      let res: Response
      let text: string
      try {
        res = await deps.fetch(COVER_API_PATH, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        })
        text = await res.text()
      } catch (error) {
        const reason: unknown = signal.aborted ? signal.reason : error
        const timedOut = reason instanceof Error && reason.name === 'TimeoutError'
        return { ok: false, error: timedOut ? 'timeout' : 'network_error' }
      }

      return res.ok ? parseCover(text) : parseError(text)
    },
  }
}
