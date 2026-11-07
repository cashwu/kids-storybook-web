<script setup lang="ts">
import { computed, toRef } from 'vue'
import type { CoverGeneration } from '../generation/useCoverGeneration'
import { useStoryReader } from '../reader/useStoryReader'
import StoryCover from './StoryCover.vue'
import type { Narration } from '../speech/useNarration'
import type { Story } from '../../shared/story'

const props = defineProps<{
  story: Story
  narration: Narration
  cover: CoverGeneration
  coverRetryLocked: boolean
}>()
defineEmits<{ retryCover: [] }>()

const reader = useStoryReader(toRef(props, 'story'), props.narration)
const { availability, activeId } = props.narration

const canPlay = computed(() => availability.value === 'ready')
const unavailableMessage = computed(() => {
  switch (availability.value) {
    case 'unsupported':
      return '這個瀏覽器不支援語音合成，無法朗讀；故事文字照常可以閱讀。'
    case 'no-english-voice':
      return '這台裝置沒有可用的英文語音，無法朗讀；故事文字照常可以閱讀。'
    default:
      return null
  }
})

// 句子 id 由頁碼與句序組成，只在目前這本故事內唯一；替換故事時 App 以 storyVersion 重建本元件讓頁碼歸零，
// useStoryGeneration 在替換前停止朗讀，舊故事的高亮才不會落在新故事同位置的句子上。
const sentenceId = (sentenceIndex: number) => `p${reader.pageIndex.value}-s${sentenceIndex}`

function playLabel(id: string) {
  if (activeId.value === id) return '暫停朗讀'
  if (availability.value === 'checking') return '正在檢查裝置語音'
  return canPlay.value ? '播放英文朗讀' : '裝置無法朗讀'
}
</script>

<template>
  <section class="card reader">
    <div class="book-head">
      <!-- 封面未就緒或失敗時，下方文字與朗讀照常可用（PLAN 3.3、A5）。 -->
      <StoryCover :cover="cover" :story="story" :retry-locked="coverRetryLocked" @retry="$emit('retryCover')" />
      <div class="titles">
        <h1 lang="en">{{ story.title.en }}</h1>
        <p class="zh">{{ story.title.zh }}</p>
        <span class="chip">🔊 由裝置內建的語音合成朗讀</span>
      </div>
    </div>

    <div v-if="unavailableMessage" class="banner status warn" role="status">
      <span class="ic" aria-hidden="true">🔇</span>
      <div>
        <b>無法朗讀</b>
        <p>{{ unavailableMessage }}</p>
      </div>
    </div>

    <div class="page">
      <div class="page-label" aria-live="polite">第 {{ reader.pageIndex.value + 1 }} 頁，共 {{ reader.pageCount.value }} 頁</div>
      <div
        v-for="(sentence, i) in reader.currentPage.value?.sentences ?? []"
        :key="sentenceId(i)"
        class="sent"
        :class="{ playing: activeId === sentenceId(i) }"
      >
        <button
          type="button"
          class="play"
          :class="{ pause: activeId === sentenceId(i), wait: !canPlay }"
          :disabled="!canPlay"
          :aria-label="playLabel(sentenceId(i))"
          :aria-pressed="activeId === sentenceId(i)"
          @click="narration.toggle(sentenceId(i), sentence.en)"
        >
          <span aria-hidden="true">{{ activeId === sentenceId(i) ? '❚❚' : '▶' }}</span>
        </button>
        <div>
          <div class="en" lang="en">{{ sentence.en }}</div>
          <div class="zh">{{ sentence.zh }}</div>
          <div v-if="activeId === sentenceId(i)" class="meta"><span class="st ok">● 正在朗讀</span></div>
        </div>
      </div>
    </div>

    <nav class="pager" aria-label="翻頁">
      <button type="button" class="btn ghost" :disabled="reader.pageIndex.value === 0" aria-label="上一頁" @click="reader.prev()">
        ←<span class="lbl"> 上一頁</span>
      </button>
      <div class="dots">
        <button
          v-for="n in reader.pageCount.value"
          :key="n"
          type="button"
          :class="{ on: reader.pageIndex.value === n - 1 }"
          :aria-label="`第 ${n} 頁`"
          :aria-current="reader.pageIndex.value === n - 1 ? 'page' : undefined"
          @click="reader.goTo(n - 1)"
        >
          {{ n }}
        </button>
      </div>
      <button
        type="button"
        class="btn ghost"
        :disabled="reader.pageIndex.value === reader.pageCount.value - 1"
        aria-label="下一頁"
        @click="reader.next()"
      >
        <span class="lbl">下一頁 </span>→
      </button>
    </nav>
  </section>
</template>
