import { describe, expect, it } from 'vitest'
import { validateStoryInput, type StoryInput } from './storyInput'

const valid: StoryInput = { character: '恐龍', situation: '第一次上學，有點害怕', pageCount: 4, apiKey: 'sk-test-fake' }

describe('validateStoryInput', () => {
  it('合格時回傳去除頭尾空白後的角色與情境，key 原樣保留', () => {
    const result = validateStoryInput({ character: '  恐龍 ', situation: '\n第一次上學 ', pageCount: 4, apiKey: 'sk-test-fake' })

    expect(result).toEqual({
      ok: true,
      value: { character: '恐龍', situation: '第一次上學', pageCount: 4, apiKey: 'sk-test-fake' },
    })
  })

  it('角色與情境只有空白、key 空白時，三個欄位都標為必填', () => {
    const result = validateStoryInput({ character: '   ', situation: '\t\n', pageCount: 4, apiKey: '' })

    expect(result).toEqual({
      ok: false,
      errors: { character: 'required', situation: 'required', apiKey: 'required' },
    })
  })

  // A2 的長度邊界：上限以去除頭尾空白後的 Unicode code point 計算（PLAN 3.7），
  // 因此頭尾空白不佔名額；中文字與英文字母各算 1。
  it('角色 30 字元、情境 100 字元可送出，頭尾空白不計入', () => {
    const result = validateStoryInput({
      ...valid,
      character: `  ${'龍'.repeat(30)}  `,
      situation: ` ${'a'.repeat(100)} `,
    })

    expect(result.ok).toBe(true)
  })

  it('角色 31 字元或情境 101 字元時，只標出超過上限的欄位', () => {
    expect(validateStoryInput({ ...valid, character: '龍'.repeat(31) })).toEqual({
      ok: false,
      errors: { character: 'too_long' },
    })
    expect(validateStoryInput({ ...valid, situation: 'a'.repeat(101) })).toEqual({
      ok: false,
      errors: { situation: 'too_long' },
    })
  })

  // 以 code point 計算：emoji 🦕 在 JavaScript 字串長度是 2，但只算 1 個字元，30 個仍可送出。
  it('emoji 以 code point 計算，30 個 🦕 不算超過角色上限', () => {
    expect(validateStoryInput({ ...valid, character: '🦕'.repeat(30) }).ok).toBe(true)
    expect(validateStoryInput({ ...valid, character: '🦕'.repeat(31) }).ok).toBe(false)
  })

  it('key 含任何空白（包含頭尾）時標為含空白，不自動修剪', () => {
    for (const apiKey of [' sk-test-fake', 'sk-test-fake\n', 'sk-test fake']) {
      expect(validateStoryInput({ ...valid, apiKey })).toEqual({ ok: false, errors: { apiKey: 'has_whitespace' } })
    }
  })

  it('key 最多 200 字元', () => {
    expect(validateStoryInput({ ...valid, apiKey: 'k'.repeat(200) }).ok).toBe(true)
    expect(validateStoryInput({ ...valid, apiKey: 'k'.repeat(201) })).toEqual({
      ok: false,
      errors: { apiKey: 'too_long' },
    })
  })

  // A2 頁數邊界：4–10 的整數（PLAN 3.7）。
  it('頁數 4 與 10 可送出', () => {
    expect(validateStoryInput({ ...valid, pageCount: 4 }).ok).toBe(true)
    expect(validateStoryInput({ ...valid, pageCount: 10 })).toEqual({ ok: true, value: { ...valid, pageCount: 10 } })
  })

  it.each([3, 11, 4.5, -4])('頁數 %s 時標為超出範圍', (pageCount) => {
    expect(validateStoryInput({ ...valid, pageCount })).toEqual({ ok: false, errors: { pageCount: 'out_of_range' } })
  })

  // 數字欄位清空時，v-model.number 會給空字串，瀏覽器也可能給 NaN；兩者都算沒填，而不是超出範圍。
  it.each([Number.NaN, '' as unknown as number, undefined as unknown as number])('頁數沒填（%j）時標為必填', (pageCount) => {
    expect(validateStoryInput({ ...valid, pageCount })).toEqual({ ok: false, errors: { pageCount: 'required' } })
  })
})
