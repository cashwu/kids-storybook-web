<script setup lang="ts">
import { computed, ref } from 'vue'
import type { StoryInputField } from '../../shared/storyInput'
import { fieldErrorMessage, STORY_ERROR_MESSAGES } from '../generation/messages'
import type { StoryGeneration } from '../generation/useStoryGeneration'

// 只負責呈現與轉發操作；送出條件、防重複提交與失敗處理都在 useStoryGeneration（tdd.md 1）。
const props = defineProps<{ generation: StoryGeneration }>()
const { form, fieldErrors, status, error, story } = props.generation

const busy = computed(() => status.value === 'generating')
const hasStory = computed(() => story.value !== null)
const errorCount = computed(() => Object.keys(fieldErrors.value).length)
const failure = computed(() => (status.value === 'failed' && error.value ? STORY_ERROR_MESSAGES[error.value] : null))

const buttonLabel = computed(() => {
  if (busy.value) return '正在寫故事…'
  if (status.value === 'failed') return '↻ 再試一次'
  return hasStory.value ? '✨ 產生新故事' : '✨ 產生故事'
})

// 只影響顯示，不改變 key 的存放位置；預設遮蔽，表單重新展開時元件重建，會回到遮蔽狀態。
const showKey = ref(false)

function errorOf(field: StoryInputField) {
  const e = fieldErrors.value[field]
  return e ? fieldErrorMessage(field, e) : null
}
</script>

<template>
  <section class="card form-card">
    <div class="form-head">
      <h2>{{ hasStory ? '建立新故事' : '寫一本新故事' }}</h2>
      <button v-if="hasStory && !busy" type="button" class="link" @click="generation.closeForm()">收起 ▲</button>
    </div>
    <p class="sub">
      {{
        hasStory
          ? '新故事的文字成功後，才會取代目前這本；失敗的話，目前這本不受影響。'
          : '告訴我們孩子喜歡的角色，和最近遇到的一件事。'
      }}
    </p>

    <form novalidate @submit.prevent="generation.submit()">
      <div class="field" :class="{ bad: errorOf('character') }">
        <label for="character">喜歡的角色</label>
        <input
          id="character"
          v-model="form.character"
          :disabled="busy"
          placeholder="例如：恐龍、小兔子、消防車"
          :aria-invalid="!!errorOf('character')"
          aria-describedby="character-err"
        />
        <div v-if="errorOf('character')" id="character-err" class="err">{{ errorOf('character') }}</div>
      </div>

      <div class="field" :class="{ bad: errorOf('situation') }">
        <label for="situation">生活情境</label>
        <textarea
          id="situation"
          v-model="form.situation"
          :disabled="busy"
          placeholder="例如：下週第一次上學，有點害怕和媽媽分開"
          :aria-invalid="!!errorOf('situation')"
          aria-describedby="situation-err"
        />
        <div v-if="errorOf('situation')" id="situation-err" class="err">{{ errorOf('situation') }}</div>
      </div>

      <div class="keybox">
        <div class="field" :class="{ bad: errorOf('apiKey') }">
          <label for="api-key">你的 OpenAI API key</label>
          <!--
            key 只綁在 form 這個當頁記憶體物件。刻意不用 type="password"：送出成功後表單會收合，
            瀏覽器與密碼管理器會把這當成登入成功並提議「儲存密碼」，使用者一按 key 就進了持久儲存（PLAN 3.2、A9）。
            改用一般文字欄位加 CSS 遮蔽：不會觸發密碼管理器的儲存提示；行動鍵盤的自動校正與學習、
            Grammarly 等擴充套件以 autocorrect 與忽略屬性盡量避免，實際效果待真實瀏覽器確認。
            不支援 CSS 遮蔽的瀏覽器會顯示明文。
          -->
          <div class="keywrap">
            <input
              id="api-key"
              v-model="form.apiKey"
              type="text"
              :class="{ masked: !showKey }"
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              data-1p-ignore
              data-lpignore="true"
              data-bwignore
              data-form-type="other"
              data-gramm="false"
              data-gramm_editor="false"
              data-enable-grammarly="false"
              :disabled="busy"
              placeholder="sk-…"
              :aria-invalid="!!errorOf('apiKey')"
              aria-describedby="api-key-err"
            />
            <button
              type="button"
              class="eye"
              aria-label="顯示 API key"
              :aria-pressed="showKey"
              :title="showKey ? '隱藏 API key' : '顯示 API key'"
              @click="showKey = !showKey"
            >
              <span aria-hidden="true">{{ showKey ? '🙈' : '👁' }}</span>
            </button>
          </div>
          <div v-if="errorOf('apiKey')" id="api-key-err" class="err">{{ errorOf('apiKey') }}</div>
        </div>
        <ul class="privacy">
          <li>key 只放在這個分頁的記憶體，<b>重新整理就會消失</b>，故事也會一起消失。</li>
          <li>key 與故事需求會經過本 app 的後端送往 OpenAI；本 app 不保存、不記錄 key。</li>
          <li>產生故事的 API 用量由這把 key 負擔。</li>
        </ul>
      </div>

      <button type="submit" class="btn primary" :disabled="busy">
        <span v-if="busy" class="spin" aria-hidden="true" />{{ buttonLabel }}
      </button>
    </form>

    <div v-if="busy" class="status info" role="status">
      <span class="spin" aria-hidden="true" />
      <div>
        <b>正在寫故事文字</b>
        <p>檢查頁數與翻譯都通過後才會顯示故事。請不要重新整理，否則 key 與故事都會清除。</p>
      </div>
    </div>
    <div v-else-if="errorCount > 0" class="status err" role="alert">
      <span class="ic" aria-hidden="true">✋</span>
      <div>
        <b>有 {{ errorCount }} 個欄位需要修正</b>
        <p>還沒有送出任何請求。</p>
      </div>
    </div>
    <div v-else-if="failure" class="status err" role="alert">
      <span class="ic" aria-hidden="true">⚠️</span>
      <div>
        <b>故事沒有產生成功：{{ failure.title }}</b>
        <p>{{ failure.detail }}</p>
        <p class="more">
          你填的內容都還在{{ hasStory ? '，目前這本故事也不受影響' : '' }}。按「再試一次」會重新送出請求，可能會再次計費。
        </p>
      </div>
    </div>
  </section>
</template>
