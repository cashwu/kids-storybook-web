// 閱讀介面使用的故事資料形狀。T2 定義 Worker 與前端共用的故事格式與驗證時，以該格式為準調整這裡。
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
