import type { AudioPlayer } from './audioPlayer'

/**
 * 以單一 HTMLAudioElement 播放 OpenAI 音檔；瀏覽器沒有 Audio 時回傳 null。
 * 重複使用同一個元素：iOS Safari 只允許在使用者點擊中開始播放，play() 由播放鈕的 click 同步呼叫。
 * 這層只做轉接，狀態規則都在 useNarration（有假 player 的測試）；實際播放靠本機與 iOS Safari 實機確認。
 */
export function createBrowserAudioPlayer(): AudioPlayer | null {
  if (typeof Audio === 'undefined') return null
  const audio = new Audio()
  // 每次 play／stop 換一個 token，被停止或被取代的那次之後送來的事件一律忽略。
  let token = 0

  function detach() {
    audio.onended = null
    audio.onerror = null
  }

  return {
    play(src, { onEnd, onError }) {
      token += 1
      const mine = token
      detach()
      audio.pause()
      const fail = () => {
        if (mine !== token) return
        detach()
        onError()
      }
      audio.onended = () => {
        if (mine !== token) return
        detach()
        onEnd()
      }
      audio.onerror = fail
      audio.src = src
      audio.currentTime = 0
      // play() 被拒絕（例如瀏覽器擋下自動播放）時當成這句出錯，畫面回到可播放。
      audio.play().catch(fail)
    },
    stop() {
      token += 1
      detach()
      audio.pause()
    },
  }
}
