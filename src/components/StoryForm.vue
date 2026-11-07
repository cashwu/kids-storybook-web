<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { PAGE_COUNT_MAX, PAGE_COUNT_MIN, type StoryInputField } from '../../shared/storyInput'
import { fieldErrorMessage, STORY_ERROR_MESSAGES } from '../generation/messages'
import { isSubmitEnter } from '../generation/submitKey'
import type { StoryGeneration } from '../generation/useStoryGeneration'

// 只負責呈現與轉發操作；送出條件、防重複提交與失敗處理都在 useStoryGeneration（tdd.md 1）。
const props = defineProps<{ generation: StoryGeneration }>()
const { form, fieldErrors, status, error, story, coverBusy, voiceBusy, voiceMode } = props.generation

// 等封面（drawing）時表單同樣鎖定：新故事要等封面結束才和文字一起發佈。
const busy = computed(() => status.value === 'generating' || status.value === 'drawing')
const hasStory = computed(() => story.value !== null)
const errorCount = computed(() => Object.keys(fieldErrors.value).length)
const failure = computed(() => (status.value === 'failed' && error.value ? STORY_ERROR_MESSAGES[error.value] : null))

const buttonLabel = computed(() => {
  // 寫文字與畫封面對使用者是同一件事，畫面不分開說明（使用者 2026-11-07 確認）。
  if (busy.value) return '故事生成中…'
  // 重試封面時不開新故事（PLAN 3.3）；通常表單此時已收合，這裡防止展開時按了卻沒有反應。
  if (coverBusy.value) return '封面產生完才能建立新故事'
  if (voiceBusy.value) return '語音產生完才能建立新故事'
  if (status.value === 'failed') return '↻ 再試一次'
  return hasStory.value ? '✨ 產生新故事' : '✨ 產生故事'
})

// key 欄位的遮蔽只影響顯示，不改變 key 的存放位置（只在 form 這個當頁記憶體物件）。
// 不用 type="password" 或 CSS 的 -webkit-text-security：Safari 會把兩者都當成密碼欄位，
// 送出後提議「儲存密碼」，使用者一按 key 就進了持久儲存（PLAN 3.2、A9）。
// 改成：輸入中（focus）顯示明文，離開欄位後換成固定長度的圓點，按圓點或眼睛按鈕才再顯示。
// 表單重新展開時元件重建，會回到遮蔽狀態。
const showKey = ref(false)
const editingKey = ref(false)
const keyInput = ref<HTMLInputElement | null>(null)
const keyMasked = computed(() => !showKey.value && !editingKey.value && form.apiKey !== '')
// 送出後欄位變成 disabled，部分瀏覽器不會觸發 blur，editingKey 會一直是 true，
// key 就在生成中與失敗後持續以明文顯示；因此開始生成時一律回到遮蔽。
watch(busy, (isBusy) => {
  if (isBusy) editingKey.value = false
})

async function editKey() {
  editingKey.value = true
  await nextTick()
  keyInput.value?.focus()
}

// 不用 <form>（同樣會被 Safari 當成登入表單），單行欄位的 Enter 由這裡送出；輸入法選字的 Enter 不送出。
function submitOnEnter(event: KeyboardEvent) {
  if (!isSubmitEnter(event)) return
  event.preventDefault()
  void props.generation.submit()
}

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

    <div class="form-body">
      <div class="field" :class="{ bad: errorOf('character') }">
        <label for="character">喜歡的角色</label>
        <input
          id="character"
          v-model="form.character"
          :disabled="busy"
          @keydown="submitOnEnter"
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

      <div class="field" :class="{ bad: errorOf('pageCount') }">
        <label for="page-count">頁數（{{ PAGE_COUNT_MIN }}–{{ PAGE_COUNT_MAX }} 頁，每頁 2 句）</label>
        <input
          id="page-count"
          v-model.number="form.pageCount"
          type="number"
          inputmode="numeric"
          :min="PAGE_COUNT_MIN"
          :max="PAGE_COUNT_MAX"
          step="1"
          class="page-count"
          :disabled="busy"
          @keydown="submitOnEnter"
          :aria-invalid="!!errorOf('pageCount')"
          aria-describedby="page-count-err"
        />
        <div v-if="errorOf('pageCount')" id="page-count-err" class="err">{{ errorOf('pageCount') }}</div>
      </div>

      <div class="field">
        <span class="label" id="voice-mode-label">朗讀方式</span>
        <!-- 選擇只在當頁記憶體，新故事沿用上次的值；閱讀中不能切換，只有失敗時的出口（PLAN 3.8）。 -->
        <div class="seg" role="radiogroup" aria-labelledby="voice-mode-label">
          <button
            type="button"
            role="radio"
            :class="{ on: voiceMode === 'device' }"
            :aria-checked="voiceMode === 'device'"
            :disabled="busy"
            @click="voiceMode = 'device'"
          >
            裝置語音
          </button>
          <button
            type="button"
            role="radio"
            :class="{ on: voiceMode === 'openai' }"
            :aria-checked="voiceMode === 'openai'"
            :disabled="busy"
            @click="voiceMode = 'openai'"
          >
            OpenAI 語音
          </button>
        </div>
        <!-- 固定費用說明，不顯示金額（PLAN 3.8「費用說明」）。 -->
        <p v-if="voiceMode === 'openai'" class="hint fee" role="note">
          會用你的 key 呼叫 OpenAI 語音，每頁第一次以英文或中文朗讀時為該頁每句計費一次，英文與中文分開計費，重播不再計費，實際費用以
          OpenAI 帳單為準。
        </p>
        <p v-else class="hint">使用這台裝置內建的語音合成，不會額外計費。</p>
      </div>

      <div class="keybox">
        <div class="field" :class="{ bad: errorOf('apiKey') }">
          <label for="api-key">你的 OpenAI API key</label>
          <!--
            離開欄位後顯示圓點按鈕，輸入中顯示明文欄位（理由見 script 的 showKey 註解）。
            輸入欄位的屬性用來避免行動鍵盤學習 key、密碼管理器與 Grammarly 等擴充套件讀取或保存，實際效果依瀏覽器而定。
          -->
          <div class="keywrap">
            <!-- 與輸入欄位共用 id：兩者是 v-if/v-else，同時只存在一個，label 點擊與錯誤訊息的關聯在遮蔽時仍有效。 -->
            <button
              v-if="keyMasked"
              id="api-key"
              type="button"
              class="key-masked"
              :disabled="busy"
              aria-label="API key 已輸入，按下以編輯"
              aria-describedby="api-key-err"
              @click="editKey"
            >
              ••••••••••••
            </button>
            <input
              v-else
              id="api-key"
              ref="keyInput"
              v-model="form.apiKey"
              type="text"
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
              @focus="editingKey = true"
              @blur="editingKey = false"
              @keydown="submitOnEnter"
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
          <li>產生故事、封面{{ voiceMode === 'openai' ? '與 OpenAI 語音' : '' }}的 API 用量由這把 key 負擔。</li>
        </ul>
      </div>

      <button type="button" class="btn primary" :disabled="busy || coverBusy || voiceBusy" @click="generation.submit()">
        {{ buttonLabel }}
      </button>
    </div>

    <div v-if="busy" class="status info" role="status">
      <span class="spin" aria-hidden="true" />
      <div>
        <b>故事生成中</b>
        <p>請不要重新整理，否則 key 與故事都會清除。</p>
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
