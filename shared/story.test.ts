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
      page({ en: 'Dino feels scared.', zh: '小恐龍覺得害怕。' }, { en: 'He holds Mom.', zh: '他抱著媽媽。' }),
      page({ en: 'A friend says hi.', zh: '一個朋友說嗨。' }, { en: 'Dino smiles.', zh: '小恐龍笑了。' }),
      page({ en: 'School is fun!', zh: '上學好好玩！' }, { en: 'See you tomorrow.', zh: '明天見。' }),
    ],
  }
}

// 這些規則決定模型輸出能否發佈為新故事（PLAN 3.3、A4）：不合格的輸出若被放行，
// 使用者會看到缺頁或缺翻譯的故事，之後也會為它請求封面。
describe('validateStory', () => {
  it('四頁、每頁 2 句且中英都有內容時通過', () => {
    expect(validateStory(validStory(), 4)).toEqual(validStory())
  })

  // 頁數由使用者在 4–10 頁之間選擇（PLAN 3.1）：只要與所選相同就通過，不同就算格式錯誤（A4），
  // 否則選 10 頁卻拿到 4 頁的故事也會被發佈。
  it('頁數與所選相同時通過，例如 10 頁', () => {
    const story = validStory()
    while (story.pages.length < 10) story.pages.push(page({ en: 'More.', zh: '更多。' }, { en: 'Again.', zh: '再一次。' }))

    expect(validateStory(story, 10)).toEqual(story)
  })

  it('頁數與所選不同時不通過：選 6 頁卻回 4 頁', () => {
    expect(validateStory(validStory(), 6)).toBeNull()
  })

  it('去除每段文字的頭尾空白，並丟掉格式以外的欄位', () => {
    const raw = {
      ...validStory(),
      extra: '<script>',
      title: { en: '  Title ', zh: ' 標題 ', html: '<b>' },
    }
    raw.pages[0]!.sentences[0] = { en: ' Dino has a bag. ', zh: ' 小恐龍有一個書包。 ' }

    const story = validateStory(raw, 4)

    expect(story).toEqual({
      ...validStory(),
      title: { en: 'Title', zh: '標題' },
    })
  })

  // 以選 4 頁為例：案例對應 A4 的「三頁、空英文、缺翻譯」以及其他頁數與句數邊界。
  it.each([
    ['只有三頁', (s: Story) => s.pages.pop()],
    ['有五頁', (s: Story) => s.pages.push(page({ en: 'More.', zh: '更多。' }))],
    ['某頁沒有句子', (s: Story) => (s.pages[1]!.sentences = [])],
    // 每頁固定 2 句（PLAN 3.1）：只有一句的頁也不採用，否則頁數再多，內容仍可能每頁只有一行。
    ['某頁只有一句', (s: Story) => s.pages[1]!.sentences.pop()],
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

    expect(validateStory(story, 4)).toBeNull()
  })

  it.each([null, 'story', [], { title: { en: 'a', zh: 'b' } }, { title: 'x', pages: [] }])(
    '不是故事物件（%j）時不通過',
    (value) => {
      expect(validateStory(value, 4)).toBeNull()
    },
  )
})
