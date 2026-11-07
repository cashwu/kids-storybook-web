// 文字模型與 reasoning effort 由部署設定調整，不是使用者選單（PLAN 3.7）。
// 目前 wrangler.jsonc 沒有設定 vars，未設定時 Worker 使用程式內的預設值，所以這裡宣告為可選。
// 依 PLAN 3.7 在 wrangler.jsonc 加入 vars 並執行 `npm run cf-typegen` 後，產生的 Env 會含這兩個屬性，屆時刪除本檔。
interface Env {
  OPENAI_TEXT_MODEL?: string
  OPENAI_TEXT_REASONING_EFFORT?: string
}
