// 瀏覽器呼叫同網域 Worker 故事文字 API 的 client（PLAN 3.2、3.7）。
import { validateStory, type Story } from '../../shared/story'
import {
  BROWSER_TEXT_TIMEOUT_MS,
  isStoryApiErrorCode,
  STORY_API_PATH,
  type StoryApiErrorCode,
  type StoryRequestBody,
} from '../../shared/storyApi'
import type { StoryInput } from '../../shared/storyInput'

export type GenerateStoryResult =
  | { ok: true; story: Story }
  | { ok: false; error: StoryApiErrorCode }

export interface StoryApi {
  generateStory(input: StoryInput): Promise<GenerateStoryResult>
}

export interface StoryApiDeps {
  fetch: typeof fetch
  /** 測試注入可手動觸發的 signal，不以真實等待驗證逾時。 */
  timeoutSignal: (ms: number) => AbortSignal
}

/** 只接受本 app 定義的錯誤類別；其他內容（例如代理回的 HTML）一律視為 upstream_error。 */
function parseError(body: unknown): GenerateStoryResult {
  const error = (body as { error?: unknown } | undefined)?.error
  return { ok: false, error: isStoryApiErrorCode(error) ? error : 'upstream_error' }
}

/**
 * 每次呼叫只送一次請求，不自動重試（PLAN 3.3）；逾時或網路錯誤一律結束為失敗，由使用者決定是否手動重試。
 * key 只放在 Authorization header，不放進 URL、body 或自訂 header（PLAN 3.2）。
 * 成功回應在前端再驗證一次，不合格就當成 invalid_story，不讓不完整的故事被發佈。
 */
export function createStoryApi(deps: StoryApiDeps): StoryApi {
  return {
    async generateStory({ character, situation, apiKey }) {
      const body: StoryRequestBody = { character, situation }
      const signal = deps.timeoutSignal(BROWSER_TEXT_TIMEOUT_MS)
      let res: Response
      let json: unknown
      try {
        res = await deps.fetch(STORY_API_PATH, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        })
        // body 無法解析（例如代理回的 HTML）時當成沒有內容；但逾時中斷要交給下方 catch 判定為 timeout。
        json = await res.json().catch((error: unknown) => {
          if (signal.aborted) throw error
          return undefined
        })
      } catch (error) {
        const reason: unknown = signal.aborted ? signal.reason : error
        const timedOut = reason instanceof Error && reason.name === 'TimeoutError'
        return { ok: false, error: timedOut ? 'timeout' : 'network_error' }
      }

      if (!res.ok) return parseError(json)
      const story = validateStory((json as { story?: unknown } | undefined)?.story)
      return story ? { ok: true, story } : { ok: false, error: 'invalid_story' }
    },
  }
}
