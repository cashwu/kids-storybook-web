<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { SPEECH_ERROR_MESSAGES } from '../generation/messages'
import type { CoverGeneration } from '../generation/useCoverGeneration'
import { useVoicePageRequests, type VoiceGeneration } from '../generation/useVoiceGeneration'
import { useStoryReader } from '../reader/useStoryReader'
import StoryCover from './StoryCover.vue'
import type { Narration } from '../speech/useNarration'
import type { Story } from '../../shared/story'

const props = defineProps<{
  story: Story
  narration: Narration
  cover: CoverGeneration
  voice: VoiceGeneration
  coverRetryLocked: boolean
}>()
defineEmits<{ retryCover: [] }>()

const reader = useStoryReader(toRef(props, 'story'), props.narration)
const { availability, activeId, language, chineseAvailable, canSelectChinese, canPlay } = props.narration
const { usesAi, showExit, locked } = props.voice

// 進入頁面、切換語言或建立新故事的鎖解除時，補送目前頁、目前語言的 OpenAI 語音（PLAN 3.8「生成時機」）。
// book 是建立本閱讀區時的書；換書後本元件即將卸載，它的 watch 不會替新書送請求。
const book = useVoicePageRequests(props.voice, reader.pageIndex, language)

// 英文聲音的問題只在英文模式顯示；能切到中文代表裝置有 zh-TW 聲音，中文模式下不需要這則警告。
const unavailableMessage = computed(() => {
  // OpenAI 語音的書不靠裝置聲音。
  if (usesAi.value || language.value !== 'en') return null
  switch (availability.value) {
    case 'unsupported':
      return '這個瀏覽器不支援語音合成，無法朗讀；故事文字照常可以閱讀。'
    case 'no-english-voice':
      return chineseAvailable.value
        ? '這台裝置沒有可用的英文語音，無法用英文朗讀；可以切換成中文朗讀，故事文字照常可以閱讀。'
        : '這台裝置沒有可用的英文語音，無法朗讀；故事文字照常可以閱讀。'
    default:
      return null
  }
})

// 聲音清單載入前（checking）不急著說沒有中文，避免一開頁就閃過錯誤說明。
const chineseHint = computed(() => {
  if (canSelectChinese.value) {
    return language.value === 'zh' ? '目前播放鈕念中文；選英文可改回英文' : '選中文後，每句的播放鈕會改念中文'
  }
  if (availability.value === 'checking') return '正在檢查裝置語音'
  return '這台裝置沒有台灣中文（zh-TW）語音，無法用中文朗讀'
})

// 句子 id 由頁碼與句序組成，只在目前這本故事內唯一；替換故事時 App 以 storyVersion 重建本元件讓頁碼歸零，
// useStoryGeneration 在替換前停止朗讀，舊故事的高亮才不會落在新故事同位置的句子上。
const sentenceId = (sentenceIndex: number) => `p${reader.pageIndex.value}-s${sentenceIndex}`

type AiState = 'ready' | 'pending' | 'failed' | 'locked'

/**
 * OpenAI 語音的書每句播放鍵的狀態（PLAN 3.8）：生成中停用；失敗可手動重試；建立新故事期間沒有音檔的句子停用、
 * 失敗的也不能重試；已有音檔的照常播放。
 */
function aiState(i: number): AiState {
  const clip = props.voice.clip(reader.pageIndex.value, i, language.value)
  if (clip?.status === 'ready') return 'ready'
  if (locked.value) return 'locked'
  if (clip?.status === 'failed') return 'failed'
  return 'pending'
}

function aiError(i: number) {
  const error = props.voice.clip(reader.pageIndex.value, i, language.value)?.error
  return error ? SPEECH_ERROR_MESSAGES[error] : ''
}

// 重試前先確認：重送是新的付費請求，逾時的上一次也可能已經計費（PLAN 3.8「失敗」、V4）。
const retryDialog = ref<HTMLDialogElement | null>(null)
const retryTarget = ref<{ page: number; sentence: number; language: 'en' | 'zh'; reason: string } | null>(null)

function onPlay(i: number, sentence: { en: string; zh: string }) {
  if (!usesAi.value) {
    props.narration.toggle(sentenceId(i), sentence)
    return
  }
  const state = aiState(i)
  if (state === 'ready') {
    const clip = props.voice.clip(reader.pageIndex.value, i, language.value)!
    props.narration.playClip(sentenceId(i), clip.url!)
  } else if (state === 'failed') {
    retryTarget.value = { page: reader.pageIndex.value, sentence: i, language: language.value, reason: aiError(i) }
    retryDialog.value?.showModal()
  }
}

function confirmRetry() {
  retryDialog.value?.close()
  const target = retryTarget.value
  // 實際是否送出由 useVoiceGeneration.retry 判斷（建立新故事期間、已改用裝置語音或已不是失敗時忽略）。
  if (target) props.voice.retry(book, target.page, target.sentence, target.language)
  retryTarget.value = null
}

function playDisabled(i: number) {
  if (!usesAi.value) return !canPlay.value
  const state = aiState(i)
  return state === 'pending' || state === 'locked'
}

function playLabel(id: string, i: number) {
  if (activeId.value === id) return '暫停朗讀'
  if (usesAi.value) {
    const state = aiState(i)
    if (state === 'pending') return 'AI 語音生成中'
    if (state === 'locked') return '建立新故事期間暫停產生語音'
    if (state === 'failed') return '語音產生失敗，按下重試'
    return language.value === 'zh' ? '播放中文 AI 朗讀' : '播放英文 AI 朗讀'
  }
  if (language.value === 'en' && availability.value === 'checking') return '正在檢查裝置語音'
  if (!canPlay.value) return '裝置無法朗讀'
  return language.value === 'zh' ? '播放中文朗讀' : '播放英文朗讀'
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
        <!-- OpenAI 要求揭露語音為 AI 產生（PLAN 3.8「費用說明」）；改用裝置語音後標示跟著改回。 -->
        <span class="chip">{{ usesAi ? '🔊 由 OpenAI 的 AI 語音朗讀' : '🔊 由裝置內建的語音合成朗讀' }}</span>
      </div>
    </div>

    <div v-if="unavailableMessage" class="banner status warn" role="status">
      <span class="ic" aria-hidden="true">🔇</span>
      <div>
        <b>無法朗讀</b>
        <p>{{ unavailableMessage }}</p>
      </div>
    </div>

    <!-- 出口：任一句失敗後才出現；按下後這本書中英文都改用裝置語音，不再送語音請求（PLAN 3.8「出口」）。 -->
    <div v-if="showExit" class="banner status warn" role="status">
      <span class="ic" aria-hidden="true">🔁</span>
      <div>
        <b>有句子的 AI 語音沒有產生成功</b>
        <p>可以按該句重試（可能再次計費），或讓這本書改用裝置語音；改用後不會再送語音請求，也不能切回 OpenAI 語音。</p>
        <div class="exit-row">
          <button type="button" class="btn ghost" @click="voice.exit()">這本書改用裝置語音</button>
        </div>
      </div>
    </div>

    <!-- 瀏覽器不支援語音合成時兩種語言都不能念，不顯示切換列，只留上方的無法朗讀說明；OpenAI 語音的書例外。 -->
    <div v-if="usesAi || availability !== 'unsupported'" class="langrow">
      <div class="seg" role="group" aria-label="朗讀語言">
        <button type="button" :class="{ on: language === 'en' }" :aria-pressed="language === 'en'" @click="narration.setLanguage('en')">
          英文
        </button>
        <button
          type="button"
          :class="{ on: language === 'zh' }"
          :aria-pressed="language === 'zh'"
          :disabled="!canSelectChinese"
          @click="narration.setLanguage('zh')"
        >
          中文
        </button>
      </div>
      <small role="status">{{ chineseHint }}</small>
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
          :class="{
            pause: activeId === sentenceId(i),
            wait: playDisabled(i),
            retry: usesAi && aiState(i) === 'failed',
          }"
          :disabled="playDisabled(i)"
          :aria-label="playLabel(sentenceId(i), i)"
          :aria-pressed="activeId === sentenceId(i)"
          @click="onPlay(i, sentence)"
        >
          <span aria-hidden="true">{{ activeId === sentenceId(i) ? '❚❚' : usesAi && aiState(i) === 'failed' ? '↻' : '▶' }}</span>
        </button>
        <div>
          <div class="en" lang="en">{{ sentence.en }}</div>
          <div class="zh">{{ sentence.zh }}</div>
          <div v-if="activeId === sentenceId(i)" class="meta"><span class="st ok">● 正在朗讀</span></div>
          <div v-else-if="usesAi && aiState(i) === 'pending'" class="meta"><span class="st wait">生成中…</span></div>
          <div v-else-if="usesAi && aiState(i) === 'failed'" class="meta">
            <span class="st err">語音沒有產生成功：{{ aiError(i) }}按 ↻ 重試，可能會再次計費。</span>
          </div>
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

    <dialog ref="retryDialog" class="dialog" aria-labelledby="speech-retry-title">
      <h3 id="speech-retry-title">重新產生這句語音？</h3>
      <p>上一次請求失敗：{{ retryTarget?.reason }}<b>重試可能會再次計費</b>。</p>
      <p>只會重新產生這一句的語音；故事文字、封面與其他句子不受影響。</p>
      <div class="row">
        <button type="button" class="btn ghost" @click="retryDialog?.close()">取消</button>
        <button type="button" class="btn primary" :disabled="locked" @click="confirmRetry">重新產生</button>
      </div>
    </dialog>
  </section>
</template>
