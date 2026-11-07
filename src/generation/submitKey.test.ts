import { describe, expect, it } from 'vitest'
import { isSubmitEnter } from './submitKey'

// 表單沒有用 <form>（Safari 會把它當成登入表單並提議儲存 key），Enter 送出由程式判斷。
// 中文輸入法選字時按的 Enter 只是確認選字，若被當成送出，使用者打到一半就會發出付費請求。
describe('isSubmitEnter', () => {
  it('一般的 Enter 視為送出', () => {
    expect(isSubmitEnter({ key: 'Enter', isComposing: false, keyCode: 13 })).toBe(true)
  })

  it('輸入法組字中的 Enter 不送出', () => {
    expect(isSubmitEnter({ key: 'Enter', isComposing: true, keyCode: 13 })).toBe(false)
  })

  // Safari 在組字結束的那次 keydown 可能已把 isComposing 設為 false，但 keyCode 仍是 229。
  it('keyCode 229（輸入法處理中）的 Enter 不送出', () => {
    expect(isSubmitEnter({ key: 'Enter', isComposing: false, keyCode: 229 })).toBe(false)
  })

  it('其他按鍵不送出', () => {
    expect(isSubmitEnter({ key: 'a', isComposing: false, keyCode: 65 })).toBe(false)
  })
})
