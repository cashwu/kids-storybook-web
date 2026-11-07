/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 朗讀語速（speechSynthesis rate，0.1–10），建置時設定；未設定或無效時用 0.1（PLAN 3.7）。 */
  readonly VITE_SPEECH_RATE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
