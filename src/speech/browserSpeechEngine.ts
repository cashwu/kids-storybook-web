import type { SpeechEngine } from './engine'

/**
 * 把瀏覽器的 speechSynthesis 包成 SpeechEngine；瀏覽器不支援時回傳 null，由 useNarration 停用播放。
 * 這層只做轉接，狀態規則都在 useNarration（有假 engine 的測試）；這裡的行為靠本機與手機人工試聽確認。
 */
export function createBrowserSpeechEngine(): SpeechEngine<SpeechSynthesisVoice> | null {
  if (
    typeof window === 'undefined' ||
    !('speechSynthesis' in window) ||
    typeof SpeechSynthesisUtterance === 'undefined'
  ) {
    return null
  }
  const synth = window.speechSynthesis
  // 保留目前 utterance 的參照：Chrome 可能回收沒被參照的 utterance，之後就不送 end 事件，高亮會卡住。
  let current: SpeechSynthesisUtterance | null = null

  return {
    getVoices: () => synth.getVoices(),
    onVoicesChanged(listener) {
      synth.addEventListener('voiceschanged', listener)
      return () => synth.removeEventListener('voiceschanged', listener)
    },
    speak({ text, lang, rate, voice }, { onEnd, onError }) {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = lang
      utterance.rate = rate
      utterance.voice = voice
      const release = () => {
        if (current === utterance) current = null
      }
      utterance.onend = () => {
        release()
        onEnd()
      }
      utterance.onerror = () => {
        release()
        onError()
      }
      current = utterance
      try {
        synth.speak(utterance)
      } catch {
        // speak 同步丟例外時不會再有事件，直接當成這句出錯，讓畫面回到可播放。
        release()
        onError()
      }
    },
    cancel: () => synth.cancel(),
  }
}
