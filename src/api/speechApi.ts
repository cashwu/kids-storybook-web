// 瀏覽器呼叫同網域 Worker 單句語音 API 的 client（PLAN 3.2、3.8）。
import {
  BROWSER_SPEECH_TIMEOUT_MS,
  isSpeechApiErrorCode,
  SPEECH_API_PATH,
  type SpeechApiErrorCode,
  type SpeechLanguage,
  type SpeechRequestBody,
} from '../../shared/speechApi'

export type GenerateSpeechResult =
  | { ok: true; audio: Blob }
  | { ok: false; error: SpeechApiErrorCode }

export interface SpeechApi {
  generateSpeech(text: string, language: SpeechLanguage, apiKey: string): Promise<GenerateSpeechResult>
}

export interface SpeechApiDeps {
  fetch: typeof fetch
  /** 測試注入可手動觸發的 signal，不以真實等待驗證逾時。 */
  timeoutSignal: (ms: number) => AbortSignal
}

/** 只接受本 app 定義的錯誤類別；其他內容（例如代理回的 HTML）一律視為 upstream_error。 */
async function parseError(res: Response): Promise<GenerateSpeechResult> {
  let error: unknown
  try {
    error = ((await res.json()) as { error?: unknown } | null)?.error
  } catch {
    error = undefined
  }
  return { ok: false, error: isSpeechApiErrorCode(error) ? error : 'upstream_error' }
}

/**
 * 每次呼叫只送一次請求，不自動重試（PLAN 3.3、3.8）；逾時或網路錯誤一律結束為失敗，由使用者手動重試該句。
 * key 只放在 Authorization header，不放進 URL、body 或自訂 header（PLAN 3.2）。
 *
 * 逾時 signal 同時涵蓋等待回應與讀完 body。Worker 自己逾時而中斷 mp3 串流時，讀 body 失敗、
 * signal 尚未觸發，結束為 network_error；截斷的音檔不會被當成成功。
 * 成功回應只接受非空的 audio 內容，避免把代理的錯誤頁交給 <audio> 播放。
 */
export function createSpeechApi(deps: SpeechApiDeps): SpeechApi {
  return {
    async generateSpeech(text, language, apiKey) {
      const body: SpeechRequestBody = { text, language }
      const signal = deps.timeoutSignal(BROWSER_SPEECH_TIMEOUT_MS)
      try {
        const res = await deps.fetch(SPEECH_API_PATH, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        })
        if (!res.ok) return await parseError(res)
        const audio = await res.blob()
        const isAudio = (res.headers.get('content-type') ?? '').startsWith('audio/')
        return isAudio && audio.size > 0 ? { ok: true, audio } : { ok: false, error: 'invalid_audio' }
      } catch (error) {
        const reason: unknown = signal.aborted ? signal.reason : error
        const timedOut = reason instanceof Error && reason.name === 'TimeoutError'
        return { ok: false, error: timedOut ? 'timeout' : 'network_error' }
      }
    },
  }
}
