const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * 本機開發（vite dev、wrangler dev）只有 http://localhost。loopback 連線不經過外部網路，
 * 因此頁面的 https 導向與 Worker 的 insecure_request 檢查都放行；部署後的 hostname 是部署網域，不會落入例外。
 * `URL.hostname` 對 IPv6 會保留中括號，所以比對 `[::1]`。
 */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname)
}
