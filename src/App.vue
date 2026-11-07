<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import StoryForm from './components/StoryForm.vue'
import StoryReader from './components/StoryReader.vue'
import { createCoverApi } from './api/coverApi'
import { createStoryApi } from './api/storyApi'
import { installLeaveGuard, shouldConfirmLeave } from './generation/leaveGuard'
import { useCoverGeneration } from './generation/useCoverGeneration'
import { useStoryGeneration } from './generation/useStoryGeneration'
import { createBrowserSpeechEngine } from './speech/browserSpeechEngine'
import { useNarration } from './speech/useNarration'
import { parseSpeechRate } from './speech/voice'

// 朗讀狀態放在 App 層、跨故事共用一份，替換故事時由 useStoryGeneration 停止舊故事的朗讀（PLAN 3.3）。
const narration = useNarration({
  engine: createBrowserSpeechEngine(),
  rate: parseSpeechRate(import.meta.env.VITE_SPEECH_RATE),
})

// 瀏覽器的全域 fetch 不能脫離原本的 this 呼叫，因此包一層。
const apiDeps = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  timeoutSignal: (ms: number) => AbortSignal.timeout(ms),
}

// 封面狀態同樣在 App 層跨故事共用一份：useStoryGeneration 在文字通過驗證後請求封面，
// 封面結束後與文字一起發佈成新書，換書時整個換成新書的封面結果（PLAN 3.3）。
const cover = useCoverGeneration(createCoverApi(apiDeps))
const generation = useStoryGeneration(createStoryApi(apiDeps), narration, cover)
const { story, storyVersion, formOpen } = generation

// 故事與輸入只在當頁記憶體，重新整理或關閉分頁前，有東西會損失時請瀏覽器確認（PLAN 3.2）。
let uninstallLeaveGuard = () => {}
onMounted(() => {
  uninstallLeaveGuard = installLeaveGuard(window, () =>
    shouldConfirmLeave({
      status: generation.status.value,
      coverBusy: cover.busy.value,
      hasStory: story.value !== null,
      character: generation.form.character,
      situation: generation.form.situation,
    }),
  )
})
onBeforeUnmount(() => uninstallLeaveGuard())

// 寫文字（generating）與畫封面（drawing）對使用者是同一件事，畫面都只說「故事生成中」。
const emptyState = computed(() => {
  const busy = generation.status.value === 'generating' || generation.status.value === 'drawing'
  return busy ? { icon: '✍️', title: '故事生成中…' } : { icon: '🦕', title: '故事會出現在這裡' }
})
</script>

<template>
  <div class="app">
    <header class="top">
      <div class="brand"><span aria-hidden="true">📖</span>雙語有聲故事書</div>
      <small>把生活小事變成中英對照的故事</small>
    </header>
    <!-- 表單展開時左右兩欄（手機上下排列）；故事成功後收合成「建立新故事」列，閱讀區占滿版面（PLAN 3.4）。 -->
    <main class="layout" :class="formOpen ? 'with-form' : 'solo'">
      <StoryForm v-if="formOpen" :generation="generation" />
      <section v-else-if="story" class="card newbar">
        <div class="cur">
          目前故事：<b>{{ story.title.zh }}</b>
          <div v-if="generation.coverBusy.value" class="hint">封面產生完才能建立新故事</div>
        </div>
        <button type="button" class="btn primary small" :disabled="generation.coverBusy.value" @click="generation.openForm()">
          ＋ 建立新故事
        </button>
      </section>

      <!-- storyVersion 改變時重建閱讀區，新故事從第一頁開始。 -->
      <StoryReader
        v-if="story"
        :key="storyVersion"
        :story="story"
        :narration="narration"
        :cover="cover"
        :cover-retry-locked="generation.coverRetryLocked.value"
        @retry-cover="generation.retryCover()"
      />
      <section v-else class="card reader">
        <div class="empty">
          <div class="big" aria-hidden="true">{{ emptyState.icon }}</div>
          <h3>{{ emptyState.title }}</h3>
          <div>一本中英對照的故事（預設 4 頁），每句英文都能點來聽。</div>
        </div>
      </section>
    </main>
  </div>
</template>
