# 生活情境雙語有聲故事書

> **目前狀態：已完成前置驗證與專案骨架（T0），核心功能尚未實作。** 以下描述的是第一版的目標功能，不是已經能用的功能。進度請看 [docs/task.md](docs/task.md)。

把孩子最近遇到的一件事，和他喜歡的角色，變成一本可以一起讀、一起聽的中英對照故事書。

第一版的目標是：輸入「恐龍」和「第一次上學，有點害怕和媽媽分開」後，得到一本以小恐龍為主角、溫和陪伴孩子面對上學的四頁故事，附一張 AI 封面，每一句英文都可以點來聽。

## 第一版會做什麼

- **輸入**：孩子喜歡的角色、生活情境，以及你自己的 OpenAI API key。故事固定以 4–5 歲孩子為對象。
- **故事**：預設四頁（可選 4–10 頁），每頁 2 句簡單英文，每句都有對應的繁體中文。
- **封面**：一張 AI 生成的封面。
- **朗讀**：逐句英文朗讀，使用裝置內建的語音合成，可以播放、暫停，正在朗讀的句子會高亮。
- **失敗也能讀**：故事文字先完成就能閱讀；封面失敗時，只需要手動重試封面。

畫面草稿：[docs/ui-mockup.html](docs/ui-mockup.html)（下載後用瀏覽器打開，可以切換各種狀態與手機寬度）。

## 關於 API key 與費用

這個 app 不提供共用 key，需要使用你自己的 OpenAI API key。設計上：

- key 只放在瀏覽器當前分頁的記憶體裡，**重新整理就會消失**，故事也會一起消失。
- key 和故事需求會經過本 app 的後端（Cloudflare Worker）轉送給 OpenAI；本 app 不保存、不記錄 key。
- 產生文字與封面的費用由你的 key 負擔；朗讀在你的裝置上完成，不經過 OpenAI。
- 付費請求失敗時不會自動重試，只有你手動按重試才會再送一次（逾時不代表 OpenAI 沒有處理，重試可能會再次計費）。

以上是第一版的設計原則，完整規則見 [docs/PLAN.md](docs/PLAN.md)；實作完成並驗收前，不代表已經驗證。

## 技術選擇

- 前端：Vite + Vue 3 + TypeScript
- 後端：單一 Cloudflare Worker + Workers Static Assets（前端與 `/api/*` 同網域部署）
- AI：OpenAI 的文字與圖片 API；朗讀用瀏覽器的 Web Speech API（`speechSynthesis`）
- 不使用資料庫或雲端儲存，故事只存在瀏覽器當頁

## 文件

| 文件 | 內容 |
| --- | --- |
| [docs/PLAN.md](docs/PLAN.md) | 需求、不做清單、行為規則、技術選擇與驗收範例 |
| [docs/task.md](docs/task.md) | 開發任務拆解（T0–T8）、依賴與驗收 |
| [docs/tdd.md](docs/tdd.md) | 測試規範與驗證指令 |
| [AGENTS.md](AGENTS.md) | 給 AI coding agent 的開發規範 |

## 開發

需要 Node.js 22.18 以上的 22.x，或 24.12 以上（見 `package.json` 的 `engines`）。`npm install` 安裝後，用 `npm run dev` 在本機啟動（前端與 Worker 同網域）；測試、型別檢查與建置指令見 [docs/tdd.md](docs/tdd.md) 第 4 節。

日常測試全部離線執行，只使用假的 OpenAI 回應，不會呼叫真實 API，也不需要 API key。

## 相關專案

- [kids-storybook-builder](https://github.com/cashwu/kids-storybook-builder)：本專案的前身，是一個讓 agent 把逐頁故事做成雙語有聲靜態網頁的 skill。這個 repo 則是給一般使用者輸入生活情境、直接生成故事的 web app。

## 授權

[MIT License](LICENSE)
