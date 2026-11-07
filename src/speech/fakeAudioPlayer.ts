import type { SpeakEvents } from './engine'
import type { AudioPlayer } from './audioPlayer'

// 測試用的假 <audio>：記錄每次 play／stop，事件由測試手動觸發。
// 與 fakeSpeechEngine 相同，stop() 不會讓舊的那次自動送事件，測試要能自行決定舊事件抵達的時間點。
export interface PlayedClip {
  src: string
  events: SpeakEvents
  /** play 當下累計的 stop 次數，用來確認換句時 stop 發生在 play 之前。 */
  stopCountAtPlay: number
}

export interface FakeAudioPlayer extends AudioPlayer {
  played: PlayedClip[]
  stopCount: number
}

export function createFakeAudioPlayer(): FakeAudioPlayer {
  const fake: FakeAudioPlayer = {
    played: [],
    stopCount: 0,
    play(src, events) {
      fake.played.push({ src, events, stopCountAtPlay: fake.stopCount })
    },
    stop() {
      fake.stopCount += 1
    },
  }
  return fake
}
