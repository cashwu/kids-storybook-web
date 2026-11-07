import { describe, expect, it } from 'vitest'
import { parseSpeechRate, pickEnglishVoice, pickTaiwanChineseVoice } from './voice'

const v = (name: string, lang: string, isDefault = false) => ({ name, lang, default: isDefault })

describe('pickEnglishVoice', () => {
  it('有標為預設的 en-US 聲音時選它', () => {
    const voices = [v('Alex', 'en-US'), v('Daniel', 'en-GB'), v('Samantha', 'en-US', true)]
    expect(pickEnglishVoice(voices)?.name).toBe('Samantha')
  })

  // 瀏覽器的 default 旗標只標一個聲音（常是系統語言，例如 zh-TW），
  // 所以沒有預設 en-US 時，先用清單中第一個 en-US，再退到其他 en-* 聲音。
  it('沒有預設 en-US 時選第一個 en-US 聲音', () => {
    const voices = [v('Meijia', 'zh-TW', true), v('Daniel', 'en-GB'), v('Alex', 'en-US')]
    expect(pickEnglishVoice(voices)?.name).toBe('Alex')
  })

  it('沒有 en-US 時選任一 en-* 聲音', () => {
    const voices = [v('Meijia', 'zh-TW', true), v('Daniel', 'en-GB')]
    expect(pickEnglishVoice(voices)?.name).toBe('Daniel')
  })

  // Android 的 lang 可能是 en_US 這類底線、大小寫不一的格式，仍要認得是英文。
  it('lang 用底線或大小寫不同的格式時仍視為英文聲音', () => {
    expect(pickEnglishVoice([v('Android', 'EN_us')])?.name).toBe('Android')
  })

  it('沒有任何英文聲音時回傳 null', () => {
    expect(pickEnglishVoice([v('Meijia', 'zh-TW', true), v('Kyoko', 'ja-JP')])).toBeNull()
    expect(pickEnglishVoice([])).toBeNull()
  })

  it('不把 lang 只是以 en 開頭的其他語言當成英文', () => {
    expect(pickEnglishVoice([v('X', 'enx-ZZ')])).toBeNull()
  })
})

// 中文朗讀只用台灣中文聲音（PLAN 3.5 第 3 項）：zh-CN 是大陸口音、zh-HK 念粵語，
// 改用它們會讓孩子聽到和課本不同的發音，因此沒有 zh-TW 時寧可不提供中文朗讀。
describe('pickTaiwanChineseVoice', () => {
  it('有標為預設的 zh-TW 聲音時選它，否則選第一個 zh-TW 聲音', () => {
    expect(pickTaiwanChineseVoice([v('Meijia', 'zh-TW'), v('Hanhan', 'zh-TW', true)])?.name).toBe('Hanhan')
    expect(pickTaiwanChineseVoice([v('Alex', 'en-US', true), v('Meijia', 'zh-TW'), v('Hanhan', 'zh-TW')])?.name).toBe('Meijia')
  })

  // Android 回報 zh_TW，部分瀏覽器帶文字代碼 zh-Hant-TW，都是同一地區的台灣中文。
  it('lang 為底線、大小寫不同或帶 Hant 文字代碼的台灣中文時仍可選', () => {
    expect(pickTaiwanChineseVoice([v('Android', 'ZH_tw')])?.name).toBe('Android')
    expect(pickTaiwanChineseVoice([v('Hant', 'zh-Hant-TW')])?.name).toBe('Hant')
  })

  it('只有 zh-CN、zh-HK、粵語或不帶地區的中文聲音時回傳 null', () => {
    const voices = [v('Tingting', 'zh-CN', true), v('Sinji', 'zh-HK'), v('Yue', 'yue-HK'), v('Zh', 'zh'), v('Hans', 'zh-Hans-CN')]
    expect(pickTaiwanChineseVoice(voices)).toBeNull()
    expect(pickTaiwanChineseVoice([])).toBeNull()
  })
})

describe('parseSpeechRate', () => {
  it('未設定時使用預設語速 0.1', () => {
    expect(parseSpeechRate(undefined)).toBe(0.1)
    expect(parseSpeechRate('')).toBe(0.1)
  })

  it('設定為 speechSynthesis 可接受範圍（0.1–10）內的數字時採用該值', () => {
    expect(parseSpeechRate('0.5')).toBe(0.5)
    expect(parseSpeechRate(' 1 ')).toBe(1)
    expect(parseSpeechRate('10')).toBe(10)
  })

  // 建置設定打錯時退回預設值，而不是把 NaN 或超出範圍的值交給瀏覽器（行為依瀏覽器而異）。
  it('不是數字或超出範圍時使用預設語速', () => {
    for (const raw of ['abc', '0', '0.05', '11', '-1', 'Infinity']) {
      expect(parseSpeechRate(raw), raw).toBe(0.1)
    }
  })
})
