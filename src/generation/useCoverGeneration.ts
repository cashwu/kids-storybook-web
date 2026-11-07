import { computed, readonly, ref, shallowRef, type Ref } from 'vue'
import type { CoverApiErrorCode } from '../../shared/coverApi'
import type { Story } from '../../shared/story'
import type { CoverApi, GenerateCoverResult } from '../api/coverApi'

/** idle：還沒有書；generating：手動重試進行中。新書的第一次封面請求不經過這個狀態，見 request。 */
export type CoverStatus = 'idle' | 'generating' | 'ready' | 'failed'

export interface CoverGeneration {
  status: Readonly<Ref<CoverStatus>>
  /** 目前這本書封面的 GIF data URL。 */
  src: Readonly<Ref<string | null>>
  error: Readonly<Ref<CoverApiErrorCode | null>>
  /** 重試請求進行中；文字生成以此擋下新故事（PLAN 3.3：生成請求進行中不另開新故事）。 */
  busy: Readonly<Ref<boolean>>
  /** 為尚未發佈的新故事送出第一次封面請求，只回傳結果，不改變目前這本書的封面。 */
  request(story: Story, apiKey: string): Promise<GenerateCoverResult>
  /** 新書發佈時呼叫：換成這本書的封面結果，並記下故事與 key 供手動重試。 */
  publish(story: Story, apiKey: string, result: GenerateCoverResult): void
  /** 只在封面失敗時重送這本書的封面；其他狀態直接忽略。 */
  retry(): void
}

/**
 * 目前這本書的封面狀態（PLAN 3.3、A5–A7）。
 *
 * 新故事要等封面請求結束（成功或失敗）才和文字一起發佈，等待期間舊書仍是目前的書，
 * 所以第一次請求（request）不碰畫面上的封面，結果由 publish 與故事一起換上。
 *
 * 必須維持的條件：
 * - 不自動重試：失敗只記錄錯誤類別，由使用者手動 retry；retry 只重送封面，不重生文字。
 * - 同一張封面不重複提交：重試中或已成功時 retry 不送出。
 * - 新舊故事隔離：publish 整個換掉封面狀態，新書封面失敗時不留舊封面；重試帶序號，
 *   換書後舊書晚到的重試結果不會寫進新書。
 *
 * key 只為了手動重試而保留在這個閉包（當頁記憶體），不寫入故事資料、URL 或瀏覽器儲存（PLAN 3.2）；
 * 換書時改存新書的 key。
 */
export function useCoverGeneration(api: CoverApi): CoverGeneration {
  const status = ref<CoverStatus>('idle')
  // GIF data URL 約 1.5 MB，整段替換、不需要深層響應。
  const src = shallowRef<string | null>(null)
  const error = ref<CoverApiErrorCode | null>(null)
  let current: { story: Story; apiKey: string } | null = null
  let version = 0

  function apply(result: GenerateCoverResult) {
    src.value = result.ok ? result.src : null
    error.value = result.ok ? null : result.error
    status.value = result.ok ? 'ready' : 'failed'
  }

  return {
    status: readonly(status),
    src: readonly(src),
    error: readonly(error),
    busy: computed(() => status.value === 'generating'),
    request: (story, apiKey) => api.generateCover(story, apiKey),
    publish(story, apiKey, result) {
      version += 1
      current = { story, apiKey }
      apply(result)
    },
    async retry() {
      if (status.value !== 'failed' || !current) return
      const id = version
      status.value = 'generating'
      error.value = null
      const result = await api.generateCover(current.story, current.apiKey)
      if (id === version) apply(result)
    },
  }
}
