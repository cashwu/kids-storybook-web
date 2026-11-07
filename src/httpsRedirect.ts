import { isLoopbackHost } from '../shared/loopback'

/** 頁面在 http 開啟時回傳要導向的 https 網址，否則回 null（PLAN 3.2）；本機 loopback 例外。 */
export function httpsRedirectTarget(href: string): string | null {
  const url = new URL(href)
  if (url.protocol !== 'http:' || isLoopbackHost(url.hostname)) return null
  url.protocol = 'https:'
  return url.href
}
