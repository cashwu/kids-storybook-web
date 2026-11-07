import { computed, reactive, readonly, ref, shallowRef, type Ref } from 'vue'
import type { Story } from '../../shared/story'
import type { StoryApiErrorCode } from '../../shared/storyApi'
import { PAGE_COUNT_DEFAULT, validateStoryInput, type StoryInput, type StoryInputErrors } from '../../shared/storyInput'
import type { StoryApi } from '../api/storyApi'
import type { CoverGeneration } from './useCoverGeneration'

export const DEMO_CHARACTER = '恐龍'
export const DEMO_SITUATION = '第一次上學，有點害怕和媽媽分開'

/** generating：等故事文字；drawing：文字已通過驗證，等封面請求結束後才一起發佈。 */
export type GenerationStatus = 'idle' | 'generating' | 'drawing' | 'failed'

export interface StoryGeneration {
  form: StoryInput
  fieldErrors: Readonly<Ref<StoryInputErrors>>
  status: Readonly<Ref<GenerationStatus>>
  error: Readonly<Ref<StoryApiErrorCode | null>>
  story: Readonly<Ref<Story | null>>
  storyVersion: Readonly<Ref<number>>
  formOpen: Readonly<Ref<boolean>>
  /** 目前這本書的封面正在重試：這段時間不能建立新故事。 */
  coverBusy: Readonly<Ref<boolean>>
  /** 建立新故事期間（等文字或等封面）不能重試目前這本書的封面。 */
  coverRetryLocked: Readonly<Ref<boolean>>
  /** 重試目前這本書的封面；建立新故事期間忽略。 */
  retryCover(): void
  submit(): Promise<void>
  openForm(): void
  closeForm(): void
}

/**
 * 故事文字的生成狀態（PLAN 3.3、A2、A3、A6、A7）。
 *
 * 必須維持的條件：
 * - 輸入不合格不送出請求，只標出欄位。
 * - 文字或封面生成中再次送出直接忽略（PLAN 3.3：仍有生成請求進行時不另開新故事）：
 *   避免重複計費，也避免舊故事的請求結果與新故事混在一起。
 * - 不自動重試：失敗只記錄錯誤類別並保留輸入（含 key），使用者自己決定是否再送。
 * - 文字成功（client 已驗證格式）才請求封面；文字失敗時不請求封面，舊故事與它的封面原封不動（A3、A4）。
 * - 封面請求結束（成功或失敗）後，文字與封面才一起發佈成新書，畫面不會先出現沒有封面的新故事；
 *   等封面期間舊書與它的封面仍是目前的書（A6）。封面用送出這次文字請求的 key。
 * - 替換故事前先停止朗讀（PLAN 3.3、A6）：句子 id 只由頁碼與句序組成，不停止的話舊故事的高亮
 *   會落在新故事同位置的句子上，裝置也會繼續念舊故事。生成中、等封面與失敗時不停止，舊故事仍是目前的書。
 *
 * key 只存在 form 這個當頁記憶體物件裡，不寫入故事資料、URL 或瀏覽器儲存（PLAN 3.2）。
 * storyVersion 讓閱讀區在換書時重建、從第一頁開始。
 */
export function useStoryGeneration(
  api: StoryApi,
  narration: { stop(): void },
  cover: Pick<CoverGeneration, 'busy' | 'request' | 'publish' | 'retry'>,
): StoryGeneration {
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

  // 建立新故事期間閱讀區仍顯示舊書與它的「重試」；這時重試會為舊書多送一次付費請求，
  // 而新書發佈後結果又會被丟棄（A7），因此鎖住。
  const coverRetryLocked = computed(() => status.value === 'generating' || status.value === 'drawing')

  async function submit() {
    if (status.value === 'generating' || status.value === 'drawing' || cover.busy.value) return
    const checked = validateStoryInput(form)
    if (!checked.ok) {
      fieldErrors.value = checked.errors
      return
    }
    fieldErrors.value = {}
    status.value = 'generating'
    error.value = null

    const result = await api.generateStory(checked.value)
    if (!result.ok) {
      error.value = result.error
      status.value = 'failed'
      return
    }

    // 封面請求一定會結束（瀏覽器端有逾時），失敗也照樣發佈故事，封面顯示失敗並可手動重試（A5）。
    status.value = 'drawing'
    const coverResult = await cover.request(result.story, checked.value.apiKey)
    narration.stop()
    story.value = result.story
    cover.publish(result.story, checked.value.apiKey, coverResult)
    storyVersion.value += 1
    status.value = 'idle'
    formOpen.value = false
  }

  return {
    form,
    fieldErrors: readonly(fieldErrors) as Readonly<Ref<StoryInputErrors>>,
    status: readonly(status),
    error: readonly(error),
    story: readonly(story) as Readonly<Ref<Story | null>>,
    storyVersion: readonly(storyVersion),
    formOpen: readonly(formOpen),
    coverBusy: cover.busy,
    coverRetryLocked,
    retryCover: () => {
      if (!coverRetryLocked.value) cover.retry()
    },
    submit,
    openForm: () => {
      formOpen.value = true
    },
    // 沒有故事時收起表單會只剩空白畫面；生成中收起則看不到進度，因此兩種情況都不收。
    closeForm: () => {
      if (story.value && status.value !== 'generating' && status.value !== 'drawing') formOpen.value = false
    },
  }
}
