import { describe, expect, it } from 'vitest'
import { installLeaveGuard, shouldConfirmLeave, type LeaveGuardState } from './leaveGuard'
import { DEMO_CHARACTER, DEMO_SITUATION } from './useStoryGeneration'

// 核心版的 key 與故事只在當頁記憶體（PLAN 3.2），重新整理或關閉分頁就消失；
// 生成中離開還會丟掉已經開始計費的請求結果。只在有東西會損失時才請瀏覽器確認，
// 空白或只剩預填範例的頁面不打擾使用者。
const idle: LeaveGuardState = {
  status: 'idle',
  coverBusy: false,
  hasStory: false,
  character: DEMO_CHARACTER,
  situation: DEMO_SITUATION,
}

describe('shouldConfirmLeave', () => {
  it('沒有故事、表單仍是預填範例時不確認', () => {
    expect(shouldConfirmLeave(idle)).toBe(false)
  })

  // generating：等故事文字；drawing：等新書的封面；coverBusy：目前這本書的封面重試中。
  // 三者都是已送出的付費請求，離開後結果丟失，重做會再計費。
  it.each([
    ['故事文字生成中', { status: 'generating' as const }],
    ['新書封面生成中', { status: 'drawing' as const }],
    ['封面重試中', { coverBusy: true }],
  ])('%s時確認', (_name, patch) => {
    expect(shouldConfirmLeave({ ...idle, ...patch })).toBe(true)
  })

  it('畫面上已有故事時確認', () => {
    expect(shouldConfirmLeave({ ...idle, hasStory: true })).toBe(true)
  })

  // 預填的 Demo 內容重新整理後會回來，不算損失；使用者改過的角色或情境才會消失。
  it.each([
    ['角色', { character: '小貓' }],
    ['情境', { situation: '第一次去看牙醫' }],
  ])('改過%s時確認', (_name, patch) => {
    expect(shouldConfirmLeave({ ...idle, ...patch })).toBe(true)
  })

  // 清空欄位或只改空白都沒有值得保留的內容；key 刻意不列入判斷，它本來就設計成不留存。
  it('角色與情境清空或只差前後空白時不確認', () => {
    expect(shouldConfirmLeave({ ...idle, character: '', situation: '   ' })).toBe(false)
    expect(shouldConfirmLeave({ ...idle, character: ` ${DEMO_CHARACTER} ` })).toBe(false)
  })

  it('文字生成失敗但已改過輸入時確認，保留輸入供再試', () => {
    expect(shouldConfirmLeave({ ...idle, status: 'failed', character: '小貓' })).toBe(true)
  })
})

function beforeUnload() {
  return new Event('beforeunload', { cancelable: true })
}

// 瀏覽器只在 beforeunload 被 preventDefault 時顯示內建的離開確認視窗，視窗文字無法自訂。
// 這裡用 Node 的 EventTarget 代替 window，只能證明有無 preventDefault；
// 實際是否跳出視窗（含手機瀏覽器常不觸發 beforeunload）需在瀏覽器手動確認。
describe('installLeaveGuard', () => {
  it('需要確認時取消 beforeunload，不需要時放行', () => {
    const target = new EventTarget()
    let confirm = false
    installLeaveGuard(target, () => confirm)

    const pass = beforeUnload()
    target.dispatchEvent(pass)
    expect(pass.defaultPrevented).toBe(false)

    // 每次事件發生時才讀取目前狀態，不是在安裝時固定下來。
    confirm = true
    const block = beforeUnload()
    target.dispatchEvent(block)
    expect(block.defaultPrevented).toBe(true)
  })

  it('解除安裝後不再攔截', () => {
    const target = new EventTarget()
    const uninstall = installLeaveGuard(target, () => true)
    uninstall()

    const event = beforeUnload()
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
