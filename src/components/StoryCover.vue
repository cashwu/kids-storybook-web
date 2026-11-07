<script setup lang="ts">
import { computed, ref } from 'vue'
import { COVER_ERROR_MESSAGES } from '../generation/messages'
import type { CoverGeneration } from '../generation/useCoverGeneration'
import type { Story } from '../../shared/story'

const props = defineProps<{
  cover: CoverGeneration
  story: Story
}>()

const { status, src, error } = props.cover
const reason = computed(() => (error.value ? COVER_ERROR_MESSAGES[error.value] : ''))
const dialog = ref<HTMLDialogElement | null>(null)

// 重試前先確認：重送是新的付費請求，逾時的上一次也可能已經計費（PLAN 3.3、A7）。
function confirmRetry() {
  dialog.value?.close()
  props.cover.retry()
}
</script>

<template>
  <!-- 封面只以 <img> 顯示 GIF data URL，不把模型輸出當成網頁內容執行（PLAN 3.1）。 -->
  <div v-if="status === 'ready' && src" class="cover ok">
    <img :src="src" :alt="`故事封面：${story.title.zh}`" />
    <span class="tag">AI 封面</span>
  </div>
  <div v-else-if="status === 'failed'" class="cover fail" role="alert">
    <span class="ficon" aria-hidden="true">🖼️</span>
    <b class="ftxt">封面失敗</b>
    <span class="fdesc">{{ reason }}故事照常可以閱讀。</span>
    <button type="button" class="mini-btn" @click="dialog?.showModal()">重試</button>
  </div>
  <div v-else class="cover load" role="status">
    <span class="spin" aria-hidden="true"></span>
    <span class="ltxt">封面繪製中</span>
  </div>

  <dialog ref="dialog" class="dialog" aria-labelledby="cover-retry-title">
    <h3 id="cover-retry-title">重新產生封面？</h3>
    <div class="quote">{{ story.title.en }}　{{ story.title.zh }}</div>
    <p>上一次請求失敗：{{ reason }}<b>重試可能會再次計費</b>。</p>
    <p>只會重新產生封面；故事文字不受影響。</p>
    <div class="row">
      <button type="button" class="btn ghost" @click="dialog?.close()">取消</button>
      <button type="button" class="btn primary" @click="confirmRetry">重新產生</button>
    </div>
  </dialog>
</template>

<style scoped>
.cover { text-align: center; }
.cover.ok img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cover .tag {
  position: absolute; bottom: 7px; right: 7px; background: #4c4f69bb; color: var(--base);
  font-size: 10.5px; padding: 1px 7px; border-radius: 999px;
}
.cover.load {
  background: repeating-linear-gradient(45deg, var(--mantle) 0 12px, var(--crust) 12px 24px);
  color: var(--subtext0); gap: 6px; font-size: 13px;
}
.cover.fail {
  background: var(--tint-red); color: var(--red); gap: 6px; font-size: 13px; padding: 10px;
  border: 1px dashed color-mix(in srgb, var(--red) 40%, var(--base));
}
.cover.fail .ficon { font-size: 26px; }
.cover.fail .fdesc { font-size: 11.5px; color: var(--subtext1); }
.mini-btn {
  border: 1px solid currentColor; background: var(--base); border-radius: 999px;
  padding: 2px 10px; font-size: 12px; color: inherit; cursor: pointer;
}
.dialog {
  border: none; border-radius: 18px; padding: 22px; max-width: 380px; width: calc(100% - 32px);
  box-shadow: 0 20px 50px #4c4f6955; color: var(--text); background: var(--base);
}
.dialog::backdrop { background: #4c4f6966; }
.dialog h3 { margin: 0 0 8px; }
.dialog p { margin: 0 0 10px; font-size: 14px; color: var(--subtext1); }
.dialog .quote {
  background: var(--mantle); border-radius: 10px; padding: 10px 12px;
  font-family: Georgia, 'Times New Roman', serif; font-size: 15px; margin-bottom: 12px;
}
.dialog .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.dialog .row .btn { width: auto; }

/* 手機寬度封面縮成 104px 小圖，只留狀態與重試按鈕；失敗原因在重試對話框裡。 */
@media (max-width: 760px) {
  .cover .tag { font-size: 9px; padding: 0 5px; bottom: 4px; right: 4px; }
  .cover.fail, .cover.load { font-size: 11px; padding: 6px; }
  .cover.fail .fdesc, .cover.fail .ficon { display: none; }
}
</style>
