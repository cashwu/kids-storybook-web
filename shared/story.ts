// 前端與 Worker 共用的故事資料格式與驗證（PLAN 3.1、3.3）。
export interface StorySentence {
  en: string
  zh: string
}

export interface StoryPage {
  sentences: StorySentence[]
}

export interface Story {
  title: { en: string; zh: string }
  pages: StoryPage[]
}

export const STORY_PAGE_COUNT = 4
export const MAX_SENTENCES_PER_PAGE = 2

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 去除頭尾空白後仍有內容才算有效文字；其他型別一律視為缺漏。 */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function bilingual(value: unknown): StorySentence | null {
  if (!isRecord(value)) return null
  const en = text(value.en)
  const zh = text(value.zh)
  return en && zh ? { en, zh } : null
}

/**
 * 驗證模型輸出是否可以發佈為故事：剛好四頁、每頁 1–2 句、每句英文與繁中都非空（一對一雙語對應）。
 *
 * 不通過回 null，呼叫端必須視為文字生成失敗，不發佈、不請求封面（PLAN 3.3、A4）。
 * 通過時回傳重新組出的物件，只保留格式內欄位並去除頭尾空白，避免模型多給的欄位流進固定介面。
 * 這裡只檢查結構與非空，不判斷內容是否真的是英文／繁中或是否適齡，那部分靠真實生成後的人工檢視。
 */
export function validateStory(value: unknown): Story | null {
  if (!isRecord(value)) return null
  const title = bilingual(value.title)
  if (!title || !Array.isArray(value.pages) || value.pages.length !== STORY_PAGE_COUNT) return null

  const pages: StoryPage[] = []
  for (const rawPage of value.pages) {
    if (!isRecord(rawPage) || !Array.isArray(rawPage.sentences)) return null
    const count = rawPage.sentences.length
    if (count < 1 || count > MAX_SENTENCES_PER_PAGE) return null
    const sentences = rawPage.sentences.map(bilingual)
    if (sentences.some((s) => s === null)) return null
    pages.push({ sentences: sentences as StorySentence[] })
  }
  return { title, pages }
}
