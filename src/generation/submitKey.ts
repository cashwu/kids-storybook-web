export interface EnterKeyEvent {
  key: string
  isComposing: boolean
  keyCode: number
}

/**
 * 判斷 keydown 是否代表「按 Enter 送出」。輸入法組字中（isComposing，或 Safari 的 keyCode 229）
 * 按的 Enter 是確認選字，不能當成送出，否則會在使用者還沒打完時發出付費請求。
 */
export function isSubmitEnter(event: EnterKeyEvent): boolean {
  return event.key === 'Enter' && !event.isComposing && event.keyCode !== 229
}
