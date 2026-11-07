<script setup lang="ts">
import StoryForm from './components/StoryForm.vue'
import StoryReader from './components/StoryReader.vue'
import { createStoryApi } from './api/storyApi'
import { useStoryGeneration } from './generation/useStoryGeneration'
import { createBrowserSpeechEngine } from './speech/browserSpeechEngine'
import { useNarration } from './speech/useNarration'
import { parseSpeechRate } from './speech/voice'

// 朗讀狀態放在 App 層，替換故事時才能在同一處停止舊故事的朗讀（PLAN 3.3，由 T3 接上）。
const narration = useNarration({
  engine: createBrowserSpeechEngine(),
  rate: parseSpeechRate(import.meta.env.VITE_SPEECH_RATE),
})

const generation = useStoryGeneration(
  createStoryApi({
    fetch: (input, init) => fetch(input, init),
    timeoutSignal: (ms) => AbortSignal.timeout(ms),
  }),
)
const { story, storyVersion, formOpen } = generation
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
        <div class="cur">目前故事：<b>{{ story.title.zh }}</b></div>
        <button type="button" class="btn primary small" @click="generation.openForm()">＋ 建立新故事</button>
      </section>

      <!-- storyVersion 改變時重建閱讀區，新故事從第一頁開始。 -->
      <StoryReader v-if="story" :key="storyVersion" :story="story" :narration="narration" />
      <section v-else class="card reader">
        <div class="empty">
          <div class="big" aria-hidden="true">{{ generation.status.value === 'generating' ? '✍️' : '🦕' }}</div>
          <h3>{{ generation.status.value === 'generating' ? '故事正在寫…' : '故事會出現在這裡' }}</h3>
          <div>一本 4 頁的中英對照故事，每句英文都能點來聽。</div>
        </div>
      </section>
    </main>
  </div>
</template>
