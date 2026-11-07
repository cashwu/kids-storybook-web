import { describe, expect, it } from 'vitest'
import { httpsRedirectTarget } from './httpsRedirect'

// workers.dev 的 http 網址不會自動轉 https（PLAN 3.2、T0 實測）；頁面若停在 http，
// 使用者輸入的 key 會以明文送出。導向發生在掛載 Vue 之前，使用者還沒有機會輸入 key。
describe('httpsRedirectTarget', () => {
  it('http 網址導向相同路徑、query 與 hash 的 https 網址', () => {
    expect(httpsRedirectTarget('http://kids.example.workers.dev/a?b=1#c')).toBe(
      'https://kids.example.workers.dev/a?b=1#c',
    )
  })

  it('已經是 https 時不導向', () => {
    expect(httpsRedirectTarget('https://kids.example.workers.dev/')).toBeNull()
  })

  // 本機開發只有 http，loopback 不經過外部網路；導向 https://localhost 反而會打不開。
  it.each(['http://localhost:5173/', 'http://127.0.0.1:8787/', 'http://[::1]:8787/'])('本機 loopback（%s）不導向', (href) => {
    expect(httpsRedirectTarget(href)).toBeNull()
  })
})
