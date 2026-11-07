import { describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { createFakeSpeechEngine, enUS } from '../speech/fakeSpeechEngine'
import { useNarration } from '../speech/useNarration'
import type { Story } from '../../shared/story'
import { useStoryReader } from './useStoryReader'

const story: Story = {
  title: { en: 'Test', zh: '測試' },
  pages: [0, 1, 2, 3].map((p) => ({ sentences: [{ en: `Page ${p}.`, zh: `第 ${p} 頁。` }] })),
}

function setup() {
  const narration = { stop: vi.fn() }
  const reader = useStoryReader(ref(story), narration)
  return { narration, reader }
}

describe('useStoryReader 翻頁', () => {
  it('從第一頁開始，提供目前頁的句子與總頁數', () => {
    const { reader } = setup()

    expect(reader.pageIndex.value).toBe(0)
    expect(reader.pageCount.value).toBe(4)
    expect(reader.currentPage.value?.sentences[0]?.en).toBe('Page 0.')
  })

  it('切到其他頁時更新目前頁並停止朗讀', () => {
    const { reader, narration } = setup()

    reader.goTo(2)

    expect(reader.pageIndex.value).toBe(2)
    expect(reader.currentPage.value?.sentences[0]?.en).toBe('Page 2.')
    expect(narration.stop).toHaveBeenCalledTimes(1)
  })

  it('下一頁與上一頁各移動一頁，並停止朗讀', () => {
    const { reader, narration } = setup()

    reader.next()
    expect(reader.pageIndex.value).toBe(1)
    reader.prev()
    expect(reader.pageIndex.value).toBe(0)
    expect(narration.stop).toHaveBeenCalledTimes(2)
  })

  // 頁碼沒變時不算切頁：例如點目前頁的頁碼、在第一頁按上一頁，不應打斷正在朗讀的句子。
  it('目標頁與目前頁相同或超出範圍時不換頁，也不停止朗讀', () => {
    const { reader, narration } = setup()

    reader.prev()
    reader.goTo(0)
    reader.goTo(-1)
    reader.goTo(4)
    reader.goTo(1.5)
    reader.goTo(3)
    reader.next()

    expect(reader.pageIndex.value).toBe(3)
    expect(narration.stop).toHaveBeenCalledTimes(1)
  })
})

// 與真實的 useNarration 組合，確認切頁後 engine 確實被取消、高亮被清除（A8），
// 而不只是呼叫了某個 stop 函式。
describe('useStoryReader 與 useNarration 組合', () => {
  it('朗讀第一頁的句子時切到下一頁，會取消朗讀並清除高亮', () => {
    const engine = createFakeSpeechEngine([enUS])
    const scope = effectScope()
    const { narration, reader } = scope.run(() => {
      const narration = useNarration({ engine, rate: 0.1 })
      return { narration, reader: useStoryReader(ref(story), narration) }
    })!
    narration.toggle('p0-s0', 'Page 0.')
    const cancelsBeforeTurn = engine.cancelCount

    reader.next()

    expect(engine.cancelCount).toBe(cancelsBeforeTurn + 1)
    expect(narration.activeId.value).toBeNull()
    scope.stop()
  })
})
