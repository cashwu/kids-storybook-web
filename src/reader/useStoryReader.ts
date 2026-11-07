import { computed, readonly, ref, type ComputedRef, type Ref } from 'vue'
import type { Story, StoryPage } from '../story/types'

export interface StoryReader {
  pageIndex: Readonly<Ref<number>>
  pageCount: ComputedRef<number>
  currentPage: ComputedRef<StoryPage | undefined>
  goTo(index: number): void
  next(): void
  prev(): void
}

/**
 * 分頁閱讀狀態。切頁時一定先停止朗讀（PLAN 3.4、A8）：舊頁的句子不在畫面上，
 * 若繼續念，使用者看不到高亮也找不到暫停鈕。頁碼沒有實際改變時不停止，避免點目前頁打斷朗讀。
 */
export function useStoryReader(story: Readonly<Ref<Story>>, narration: { stop(): void }): StoryReader {
  const pageIndex = ref(0)
  const pageCount = computed(() => story.value.pages.length)

  function goTo(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= pageCount.value) return
    if (index === pageIndex.value) return
    narration.stop()
    pageIndex.value = index
  }

  return {
    pageIndex: readonly(pageIndex),
    pageCount,
    currentPage: computed(() => story.value.pages[pageIndex.value]),
    goTo,
    next: () => goTo(pageIndex.value + 1),
    prev: () => goTo(pageIndex.value - 1),
  }
}
