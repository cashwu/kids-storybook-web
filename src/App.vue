<script setup lang="ts">
import StoryReader from './components/StoryReader.vue'
import { createBrowserSpeechEngine } from './speech/browserSpeechEngine'
import { useNarration } from './speech/useNarration'
import { parseSpeechRate } from './speech/voice'
import { sampleStory } from './story/sampleStory'

// T1 只有閱讀介面，顯示固定範例故事；輸入表單與真實生成由 T2 加入。
// 朗讀狀態放在 App 層，之後替換故事時才能在同一處停止舊故事的朗讀（PLAN 3.3）。
const narration = useNarration({
  engine: createBrowserSpeechEngine(),
  rate: parseSpeechRate(import.meta.env.VITE_SPEECH_RATE),
})
</script>

<template>
  <div class="app">
    <header class="top">
      <div class="brand"><span aria-hidden="true">📖</span>雙語有聲故事書</div>
      <small>把生活小事變成中英對照的故事</small>
    </header>
    <main class="layout">
      <StoryReader :story="sampleStory" :narration="narration" sample />
    </main>
  </div>
</template>
