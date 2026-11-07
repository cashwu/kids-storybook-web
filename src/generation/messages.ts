// 生成流程的畫面文案。錯誤類別以 Record 對應，新增類別時型別檢查會要求補上文案。
// 文案只描述錯誤類別，不帶入任何回應內容，因此不會顯示 key 或 OpenAI 的錯誤原文。
import type { StoryApiErrorCode } from '../../shared/storyApi'
import { CHARACTER_MAX, SITUATION_MAX, type StoryInputError, type StoryInputField } from '../../shared/storyInput'

export const STORY_ERROR_MESSAGES: Record<StoryApiErrorCode, { title: string; detail: string }> = {
  invalid_input: { title: '輸入內容沒有通過檢查。', detail: '請確認角色、生活情境與 API key 後再試一次。' },
  insecure_request: { title: '連線不是 https，沒有送出。', detail: '請改用 https:// 開頭的網址開啟本頁。' },
  not_found: { title: '故事服務暫時無法使用。', detail: '請稍後再試。' },
  method_not_allowed: { title: '故事服務暫時無法使用。', detail: '請稍後再試。' },
  invalid_key: { title: 'API key 無效。', detail: '請確認 key 是否正確，修改後按「再試一次」。' },
  permission_denied: { title: '這把 API key 沒有使用權限。', detail: '請確認帳戶能使用產生故事所需的模型。' },
  rate_limited: { title: 'OpenAI 暫時限制了請求次數。', detail: '請稍等一下再試。' },
  insufficient_quota: { title: '這把 API key 的額度不足。', detail: '請確認 OpenAI 帳戶的額度或付款設定後再試。' },
  timeout: { title: '等待太久沒有回應。', detail: '逾時不代表 OpenAI 沒有處理，這次請求可能已經計費。' },
  network_error: { title: '連線失敗。', detail: '請確認網路連線後再試。' },
  upstream_error: { title: 'OpenAI 暫時出了問題。', detail: '請稍後再試。' },
  story_refused: { title: '這次沒有產生故事。', detail: '模型拒絕依照這個內容寫故事，可以換個說法再試。' },
  invalid_story: {
    title: '這次產生的故事格式不完整，沒有採用。',
    detail: '例如頁數不是 4 頁，或有句子缺少中文翻譯。',
  },
}

const FIELD_LABELS: Record<StoryInputField, string> = {
  character: '喜歡的角色',
  situation: '生活情境',
  apiKey: 'API key',
}

export function fieldErrorMessage(field: StoryInputField, error: StoryInputError): string {
  switch (error) {
    case 'required':
      return field === 'apiKey' ? '請輸入 API key。' : `請填寫${FIELD_LABELS[field]}。`
    case 'too_long':
      if (field === 'character') return `角色最多 ${CHARACTER_MAX} 個字。`
      if (field === 'situation') return `生活情境最多 ${SITUATION_MAX} 個字。`
      return 'API key 太長，請確認是否貼上了多餘的內容。'
    case 'has_whitespace':
      return 'API key 不能有空白或換行，請檢查開頭與結尾。'
  }
}
