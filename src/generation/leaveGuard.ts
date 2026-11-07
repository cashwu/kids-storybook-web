import { DEMO_CHARACTER, DEMO_SITUATION, type GenerationStatus } from './useStoryGeneration'

export interface LeaveGuardState {
  status: GenerationStatus
  /** 目前這本書的封面重試中。 */
  coverBusy: boolean
  hasStory: boolean
  character: string
  situation: string
}

/**
 * 重新整理或關閉分頁前是否要請瀏覽器確認（PLAN 3.2）。
 *
 * 只在會損失東西時確認：付費請求進行中（離開就丟掉結果、重做會再計費）、畫面上已有故事，
 * 或使用者改過角色或情境。預填的 Demo 內容重新整理後會回來，不算損失；
 * key 不列入判斷，它本來就只在當頁記憶體、設計成不留存。
 */
export function shouldConfirmLeave(state: LeaveGuardState): boolean {
  if (state.status === 'generating' || state.status === 'drawing' || state.coverBusy) return true
  if (state.hasStory) return true
  return isEdited(state.character, DEMO_CHARACTER) || isEdited(state.situation, DEMO_SITUATION)
}

function isEdited(value: string, demo: string): boolean {
  const trimmed = value.trim()
  return trimmed !== '' && trimmed !== demo
}

/**
 * 在 target（通常是 window）掛上 beforeunload，需要時 preventDefault 讓瀏覽器顯示內建的離開確認視窗。
 * 視窗文字由瀏覽器決定、無法自訂；手機瀏覽器關分頁或切 app 時常不觸發，這只是提醒，不保證資料留住。
 * shouldConfirm 在每次事件發生時才呼叫，讀到的是當下狀態。回傳解除安裝的函式。
 */
export function installLeaveGuard(target: EventTarget, shouldConfirm: () => boolean): () => void {
  const onBeforeUnload = (event: Event) => {
    if (shouldConfirm()) event.preventDefault()
  }
  target.addEventListener('beforeunload', onBeforeUnload)
  return () => target.removeEventListener('beforeunload', onBeforeUnload)
}
