// 朗讀模組依賴的最小語音介面。useNarration 只透過這個介面發聲，
// 測試注入假的 engine，不需要瀏覽器的 speechSynthesis，也不會實際發聲。
export interface VoiceInfo {
  name: string
  lang: string
  default: boolean
}

export interface SpeakRequest<V extends VoiceInfo = VoiceInfo> {
  text: string
  lang: string
  rate: number
  voice: V
}

export interface SpeakEvents {
  onEnd(): void
  onError(): void
}

export interface SpeechEngine<V extends VoiceInfo = VoiceInfo> {
  getVoices(): V[]
  /** 註冊聲音清單變動的 listener，回傳取消註冊的函式。 */
  onVoicesChanged(listener: () => void): () => void
  speak(request: SpeakRequest<V>, events: SpeakEvents): void
  cancel(): void
}
