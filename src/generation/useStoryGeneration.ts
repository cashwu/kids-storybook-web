import { reactive, readonly, ref, shallowRef, type Ref } from 'vue'
import type { Story } from '../../shared/story'
import type { StoryApiErrorCode } from '../../shared/storyApi'
import { PAGE_COUNT_DEFAULT, validateStoryInput, type StoryInput, type StoryInputErrors } from '../../shared/storyInput'
import type { StoryApi } from '../api/storyApi'

export const DEMO_CHARACTER = '恐龍'
export const DEMO_SITUATION = '第一次上學，有點害怕和媽媽分開'

export type GenerationStatus = 'idle' | 'generating' | 'failed'

export interface StoryGeneration {
  form: StoryInput
  fieldErrors: Readonly<Ref<StoryInputErrors>>
  status: Readonly<Ref<GenerationStatus>>
  error: Readonly<Ref<StoryApiErrorCode | null>>
  story: Readonly<Ref<Story | null>>
  storyVersion: Readonly<Ref<number>>
  formOpen: Readonly<Ref<boolean>>
  submit(): Promise<void>
  openForm(): void
  closeForm(): void
}

/**
 * 故事文字的生成狀態（PLAN 3.3、A2、A3、A6、A7）。
 *
 * 必須維持的條件：
 * - 輸入不合格不送出請求，只標出欄位。
 * - 生成中再次送出直接忽略：避免重複計費，也避免兩個回應互相覆蓋。
 * - 不自動重試：失敗只記錄錯誤類別並保留輸入（含 key），使用者自己決定是否再送。
 * - 文字成功（client 已驗證格式）才替換故事；失敗時舊故事原封不動。
 *
 * key 只存在 form 這個當頁記憶體物件裡，不寫入故事資料、URL 或瀏覽器儲存（PLAN 3.2）。
 * 替換故事時停止舊朗讀屬於 T3，這裡只提供 storyVersion 讓閱讀區在換書時重新從第一頁開始。
 */
export function useStoryGeneration(api: StoryApi): StoryGeneration {
  const form = reactive<StoryInput>({
    character: DEMO_CHARACTER,
    situation: DEMO_SITUATION,
    pageCount: PAGE_COUNT_DEFAULT,
    apiKey: '',
  })
  const fieldErrors = ref<StoryInputErrors>({})
  const status = ref<GenerationStatus>('idle')
  const error = ref<StoryApiErrorCode | null>(null)
  // 故事整本替換、不逐欄修改，shallowRef 即可，也避免把故事包成深層 reactive。
  const story = shallowRef<Story | null>(null)
  const storyVersion = ref(0)
  const formOpen = ref(true)

  async function submit() {
    if (status.value === 'generating') return
    const checked = validateStoryInput(form)
    if (!checked.ok) {
      fieldErrors.value = checked.errors
      return
    }
    fieldErrors.value = {}
    status.value = 'generating'
    error.value = null

    const result = await api.generateStory(checked.value)
    if (result.ok) {
      story.value = result.story
      storyVersion.value += 1
      status.value = 'idle'
      formOpen.value = false
    } else {
      error.value = result.error
      status.value = 'failed'
    }
  }

  return {
    form,
    fieldErrors: readonly(fieldErrors) as Readonly<Ref<StoryInputErrors>>,
    status: readonly(status),
    error: readonly(error),
    story: readonly(story) as Readonly<Ref<Story | null>>,
    storyVersion: readonly(storyVersion),
    formOpen: readonly(formOpen),
    submit,
    openForm: () => {
      formOpen.value = true
    },
    // 沒有故事時收起表單會只剩空白畫面；生成中收起則看不到進度，因此兩種情況都不收。
    closeForm: () => {
      if (story.value && status.value !== 'generating') formOpen.value = false
    },
  }
}
