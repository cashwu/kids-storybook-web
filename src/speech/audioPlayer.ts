import type { SpeakEvents } from './engine'

// 播放 OpenAI 音檔的最小介面（PLAN 3.8）。useNarration 只透過這個介面播放音檔，
// 測試注入假的 player，不需要瀏覽器的 <audio>，也不會實際發聲。
export interface AudioPlayer {
  /** 從頭播放 src；播完送 onEnd，載入或播放失敗送 onError。 */
  play(src: string, events: SpeakEvents): void
  /** 停止目前播放；被停止的那次之後不再送事件。 */
  stop(): void
}
