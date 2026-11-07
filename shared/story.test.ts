import { describe, expect, it } from 'vitest'
import { validateStory, type Story } from './story'

function page(...sentences: Array<{ en: string; zh: string }>) {
  return { sentences }
}

function validStory(): Story {
  return {
    title: { en: "Dino's First Day", zh: '小恐龍上學去' },
    pages: [
      page({ en: 'Dino has a bag.', zh: '小恐龍有一個書包。' }, { en: 'He goes to school.', zh: '他去上學。' }),
      page({ en: 'Dino feels scared.', zh: '小恐龍覺得害怕。' }),
      page({ en: 'A friend says hi.', zh: '一個朋友說嗨。' }),
      page({ en: 'School is fun!', zh: '上學好好玩！' }),
    ],
  }
}

// 這些規則決定模型輸出能否發佈為新故事（PLAN 3.3、A4）：不合格的輸出若被放行，
// 使用者會看到缺頁或缺翻譯的故事，之後也會為它請求封面。
describe('validateStory', () => {
  it('四頁、每頁 1–2 句且中英都有內容時通過', () => {
    expect(validateStory(validStory())).toEqual(validStory())
  })

  it('去除每段文字的頭尾空白，並丟掉格式以外的欄位', () => {
    const raw = {
      ...validStory(),
      extra: '<script>',
      title: { en: '  Title ', zh: ' 標題 ', html: '<b>' },
    }
    raw.pages[0]!.sentences[0] = { en: ' Dino has a bag. ', zh: ' 小恐龍有一個書包。 ' }

    const story = validateStory(raw)

    expect(story).toEqual({
      ...validStory(),
      title: { en: 'Title', zh: '標題' },
    })
  })

  // 案例對應 A4 的「三頁、空英文、缺翻譯」以及其他頁數與句數邊界。
  it.each([
    ['只有三頁', (s: Story) => s.pages.pop()],
    ['有五頁', (s: Story) => s.pages.push(page({ en: 'More.', zh: '更多。' }))],
    ['某頁沒有句子', (s: Story) => (s.pages[1]!.sentences = [])],
    [
      '某頁有三句',
      (s: Story) => s.pages[0]!.sentences.push({ en: 'Third.', zh: '第三句。' }),
    ],
    ['英文只有空白', (s: Story) => (s.pages[2]!.sentences[0]!.en = '   ')],
    ['缺少中文翻譯', (s: Story) => delete (s.pages[3]!.sentences[0] as Partial<{ zh: string }>).zh],
    ['翻譯不是字串', (s: Story) => ((s.pages[3]!.sentences[0] as unknown as { zh: number }).zh = 1)],
    ['英文標題是空字串', (s: Story) => (s.title.en = '')],
    ['缺少中文標題', (s: Story) => delete (s.title as Partial<Story['title']>).zh],
  ])('%s時不通過', (_name, mutate) => {
    const story = validStory()
    mutate(story)

    expect(validateStory(story)).toBeNull()
  })

  it.each([null, 'story', [], { title: { en: 'a', zh: 'b' } }, { title: 'x', pages: [] }])(
    '不是故事物件（%j）時不通過',
    (value) => {
      expect(validateStory(value)).toBeNull()
    },
  )
})
