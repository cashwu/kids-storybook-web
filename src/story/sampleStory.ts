import type { Story } from './types'

// T1 開發用的固定範例故事（取自 ui-mockup 的 Demo 案例：恐龍、第一次上學）。
// 只用來驗證閱讀與朗讀介面，不是線上生成成功的證據；真實生成由 T2 接入。
export const sampleStory: Story = {
  title: { en: "Dino's First Day", zh: '小恐龍上學去' },
  pages: [
    {
      sentences: [
        { en: 'Dino has a new backpack.', zh: '小恐龍有一個新書包。' },
        { en: 'Today is his first day of school.', zh: '今天是他第一天上學。' },
      ],
    },
    {
      sentences: [
        { en: 'Dino feels a little scared.', zh: '小恐龍覺得有一點害怕。' },
        { en: "He holds Mom's hand tight.", zh: '他緊緊牽著媽媽的手。' },
      ],
    },
    {
      sentences: [
        { en: 'A girl says, “Hi! Do you like blocks?”', zh: '一個女孩說：「嗨！你喜歡積木嗎？」' },
        { en: 'Dino smiles and says, “Yes!”', zh: '小恐龍笑著說：「喜歡！」' },
      ],
    },
    {
      sentences: [{ en: 'At home, Dino says, “School is fun!”', zh: '回到家，小恐龍說：「上學好好玩！」' }],
    },
  ],
}
