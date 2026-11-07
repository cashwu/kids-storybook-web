import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { createFakeSpeechEngine, enUS, zhTW } from './fakeSpeechEngine'
import { useNarration, type NarrationOptions } from './useNarration'

const s0 = { en: 'Dino has a new backpack.', zh: '恐龍有一個新書包。' }
const s1 = { en: 'Today is his first day of school.', zh: '今天是他第一天上學。' }
const zhCN = { name: 'Tingting', lang: 'zh-CN', default: false }

// 所有案例都用假 engine，只能證明朗讀狀態的切換與對 engine 的呼叫順序；
// 各裝置的真實聲音、語速與事件時序由本機與手機的人工試聽確認。
function setup(options: Partial<NarrationOptions> & Pick<NarrationOptions, 'engine'>) {
  const scope = effectScope()
  const narration = scope.run(() => useNarration({ rate: 0.1, voiceWaitMs: 1000, ...options }))!
  return { scope, narration }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useNarration 裝置可朗讀狀態', () => {
  it('瀏覽器沒有 speechSynthesis 時標為不支援，按播放不會開始朗讀', () => {
    const { narration } = setup({ engine: null })

    narration.toggle('p0-s0', s0)

    expect(narration.availability.value).toBe('unsupported')
    expect(narration.activeId.value).toBeNull()
  })

  it('聲音清單只有非英文聲音時標為沒有英文聲音，按播放不送出朗讀', () => {
    const engine = createFakeSpeechEngine([zhTW])
    const { narration } = setup({ engine })

    narration.toggle('p0-s0', s0)

    expect(narration.availability.value).toBe('no-english-voice')
    expect(narration.activeId.value).toBeNull()
    expect(engine.spoken).toHaveLength(0)
  })

  // Chrome 第一次呼叫 getVoices() 常回空陣列，聲音載入後才送 voiceschanged；
  // 空清單不能直接判定為沒有英文聲音。
  it('聲音清單一開始是空的，收到 voiceschanged 後有英文聲音就可播放', () => {
    const engine = createFakeSpeechEngine([])
    const { narration } = setup({ engine })
    expect(narration.availability.value).toBe('checking')

    engine.voices = [zhTW, enUS]
    engine.emitVoicesChanged()

    expect(narration.availability.value).toBe('ready')
  })

  // 有些瀏覽器聲音清單始終是空的、也不送 voiceschanged；等候時間到仍為空就停用播放，
  // 避免按鈕永遠停在「檢查中」。之後若聲音才載入，仍可恢復為可播放。
  it('聲音清單一直是空的時，等候時間到後標為沒有英文聲音，之後聲音載入仍可恢復', () => {
    vi.useFakeTimers()
    const engine = createFakeSpeechEngine([])
    const { narration } = setup({ engine, voiceWaitMs: 1000 })

    vi.advanceTimersByTime(999)
    expect(narration.availability.value).toBe('checking')
    vi.advanceTimersByTime(1)
    expect(narration.availability.value).toBe('no-english-voice')

    engine.voices = [enUS]
    engine.emitVoicesChanged()
    expect(narration.availability.value).toBe('ready')
  })

  // 有些瀏覽器不送 voiceschanged，但聲音清單會在等候期間悄悄載入；逾時若只看先前的結果，
  // 有英文聲音的裝置會被永久判定為無法朗讀（之後沒有事件能恢復）。
  it('沒收到 voiceschanged 但等候期間清單已載入英文聲音時，逾時後可播放', () => {
    vi.useFakeTimers()
    const engine = createFakeSpeechEngine([])
    const { narration } = setup({ engine, voiceWaitMs: 1000 })

    engine.voices = [enUS]
    vi.advanceTimersByTime(1000)

    expect(narration.availability.value).toBe('ready')
  })

  it('朗讀中聲音清單變成沒有英文聲音時，停止朗讀並停用播放', () => {
    const engine = createFakeSpeechEngine([enUS])
    const { narration } = setup({ engine })
    narration.toggle('p0-s0', s0)

    const cancelsBeforeChange = engine.cancelCount

    engine.voices = [zhTW]
    engine.emitVoicesChanged()

    expect(narration.availability.value).toBe('no-english-voice')
    expect(narration.activeId.value).toBeNull()
    expect(engine.cancelCount).toBe(cancelsBeforeChange + 1)
  })
})

describe('useNarration 逐句播放與暫停', () => {
  it('播放一句時以 en-US、設定的語速與選定的英文聲音朗讀該句，並標為正在朗讀', () => {
    const engine = createFakeSpeechEngine([zhTW, enUS])
    const { narration } = setup({ engine, rate: 0.3 })

    narration.toggle('p0-s0', s0)

    expect(engine.spoken).toHaveLength(1)
    expect(engine.spoken[0]!.request).toEqual({
      text: 'Dino has a new backpack.',
      lang: 'en-US',
      rate: 0.3,
      voice: enUS,
    })
    expect(narration.activeId.value).toBe('p0-s0')
  })

  // 暫停的語意是停止這句並清除高亮，再按一次從句首重播（不使用 speechSynthesis.pause()）。
  it('再按一次正在朗讀的句子會停止朗讀並清除高亮，再按會從頭朗讀', () => {
    const engine = createFakeSpeechEngine([enUS])
    const { narration } = setup({ engine })
    narration.toggle('p0-s0', s0)
    const cancelsBeforePause = engine.cancelCount

    narration.toggle('p0-s0', s0)

    expect(engine.cancelCount).toBe(cancelsBeforePause + 1)
    expect(narration.activeId.value).toBeNull()
    expect(engine.spoken).toHaveLength(1)

    narration.toggle('p0-s0', s0)
    expect(engine.spoken).toHaveLength(2)
    expect(narration.activeId.value).toBe('p0-s0')
  })

  // 同時只能播一句：播第二句前必須先 cancel，否則 speechSynthesis 會把第二句排在第一句後面。
  it('播第一句時改播第二句，會先取消第一句再朗讀第二句，只有第二句高亮', () => {
    const engine = createFakeSpeechEngine([enUS])
    const { narration } = setup({ engine })
    narration.toggle('p0-s0', s0)
    const cancelsBeforeSecond = engine.cancelCount

    narration.toggle('p0-s1', s1)

    expect(engine.cancelCount).toBe(cancelsBeforeSecond + 1)
    expect(engine.spoken[1]!.cancelCountAtSpeak).toBe(cancelsBeforeSecond + 1)
    expect(engine.spoken.map((u) => u.request.text)).toEqual([
      'Dino has a new backpack.',
      'Today is his first day of school.',
    ])
    expect(narration.activeId.value).toBe('p0-s1')
  })

  // 瀏覽器在 cancel 後才非同步送出被取消那句的 end／error。若沒有分辨事件屬於哪一句，
  // 舊句的事件會清掉第二句的高亮，畫面顯示沒在朗讀、實際上卻還在念第二句。
  it('被取消的前一句晚到的 end 或 error 事件，不會清除目前句子的高亮', () => {
    const engine = createFakeSpeechEngine([enUS])
    const { narration } = setup({ engine })
    narration.toggle('p0-s0', s0)
    narration.toggle('p0-s1', s1)

    engine.spoken[0]!.events.onError()
    engine.spoken[0]!.events.onEnd()

    expect(narration.activeId.value).toBe('p0-s1')
  })

  it('目前句子念完時清除高亮', () => {
    const engine = createFakeSpeechEngine([enUS])
    const { narration } = setup({ engine })
    narration.toggle('p0-s0', s0)

    engine.spoken[0]!.events.onEnd()

    expect(narration.activeId.value).toBeNull()
  })

  it('目前句子朗讀出錯時清除高亮並回到可播放，再按一次會重新朗讀', () => {
    const engine = createFakeSpeechEngine([enUS])
    const { narration } = setup({ engine })
    narration.toggle('p0-s0', s0)

    engine.spoken[0]!.events.onError()

    expect(narration.activeId.value).toBeNull()
    expect(narration.availability.value).toBe('ready')
    narration.toggle('p0-s0', s0)
    expect(engine.spoken).toHaveLength(2)
    expect(narration.activeId.value).toBe('p0-s0')
  })

  it('stop() 取消朗讀並清除高亮', () => {
    const engine = createFakeSpeechEngine([enUS])
    const { narration } = setup({ engine })
    narration.toggle('p0-s0', s0)
    const cancelsBeforeStop = engine.cancelCount

    narration.stop()

    expect(engine.cancelCount).toBe(cancelsBeforeStop + 1)
    expect(narration.activeId.value).toBeNull()
  })

  // 元件卸載後若沒取消，瀏覽器會繼續念完已排入的句子，且 listener 留著會持有已卸載的狀態。
  it('所屬的 effect scope 結束時取消朗讀並移除 voiceschanged listener', () => {
    const engine = createFakeSpeechEngine([enUS])
    const { scope, narration } = setup({ engine })
    narration.toggle('p0-s0', s0)
    expect(engine.listenerCount()).toBe(1)
    const cancelsBeforeDispose = engine.cancelCount

    scope.stop()

    expect(engine.cancelCount).toBe(cancelsBeforeDispose + 1)
    expect(engine.listenerCount()).toBe(0)
  })
})

// 中文朗讀（PLAN 3.5 第 3 項、Z1–Z5）。語言選擇放在 App 層共用的 narration 裡，
// 所以「新故事沿用」由 stop() 不重設語言來保證；替換故事時 useStoryGeneration 只呼叫 stop()。
describe('useNarration 朗讀語言', () => {
  it('預設英文；有 zh-TW 聲音時中文可選，英文模式播放念英文', () => {
    const engine = createFakeSpeechEngine([enUS, zhTW])
    const { narration } = setup({ engine })

    narration.toggle('p0-s0', s0)

    expect(narration.language.value).toBe('en')
    expect(narration.chineseAvailable.value).toBe(true)
    expect(engine.spoken[0]!.request).toMatchObject({ text: s0.en, lang: 'en-US', voice: enUS })
  })

  // 切換語言若沒停止，舊語言那句會繼續念、高亮也留在原句，畫面和聲音對不上。
  it('英文朗讀中切到中文會停止並清除高亮，之後播放以 zh-TW 聲音與相同語速念該句中文', () => {
    const engine = createFakeSpeechEngine([enUS, zhTW])
    const { narration } = setup({ engine, rate: 0.3 })
    narration.toggle('p0-s0', s0)
    const cancelsBeforeSwitch = engine.cancelCount

    narration.setLanguage('zh')

    expect(narration.language.value).toBe('zh')
    expect(narration.activeId.value).toBeNull()
    expect(engine.cancelCount).toBe(cancelsBeforeSwitch + 1)
    // 被取消那句晚到的 end 不能影響切換後的狀態。
    engine.spoken[0]!.events.onEnd()

    narration.toggle('p0-s0', s0)
    expect(engine.spoken[1]!.request).toEqual({ text: s0.zh, lang: 'zh-TW', rate: 0.3, voice: zhTW })
    expect(narration.activeId.value).toBe('p0-s0')
  })

  it('再選目前已選的語言不會打斷朗讀', () => {
    const engine = createFakeSpeechEngine([enUS, zhTW])
    const { narration } = setup({ engine })
    narration.toggle('p0-s0', s0)
    const cancelsBefore = engine.cancelCount

    narration.setLanguage('en')

    expect(narration.activeId.value).toBe('p0-s0')
    expect(engine.cancelCount).toBe(cancelsBefore)
  })

  // 只有 zh-CN 時不能改用它念中文（大陸口音），中文不可選且英文朗讀照常、不被打斷。
  it('沒有 zh-TW 聲音時中文不可選，切換被忽略且英文朗讀不受影響', () => {
    const engine = createFakeSpeechEngine([enUS, zhCN])
    const { narration } = setup({ engine })
    narration.toggle('p0-s0', s0)
    const cancelsBefore = engine.cancelCount

    narration.setLanguage('zh')

    expect(narration.chineseAvailable.value).toBe(false)
    expect(narration.language.value).toBe('en')
    expect(narration.activeId.value).toBe('p0-s0')
    expect(engine.cancelCount).toBe(cancelsBefore)
    expect(narration.canPlay.value).toBe(true)
  })

  it('有 zh-TW 但沒有英文聲音時，英文模式不能播放，切到中文後可以朗讀中文', () => {
    const engine = createFakeSpeechEngine([zhTW])
    const { narration } = setup({ engine })
    expect(narration.availability.value).toBe('no-english-voice')
    expect(narration.canPlay.value).toBe(false)

    narration.setLanguage('zh')
    narration.toggle('p0-s0', s0)

    expect(narration.canPlay.value).toBe(true)
    expect(engine.spoken.map((u) => u.request.text)).toEqual([s0.zh])
  })

  it('stop()（切頁或替換故事）停止朗讀但保留中文模式', () => {
    const engine = createFakeSpeechEngine([enUS, zhTW])
    const { narration } = setup({ engine })
    narration.setLanguage('zh')
    narration.toggle('p0-s0', s0)

    narration.stop()

    expect(narration.activeId.value).toBeNull()
    expect(narration.language.value).toBe('zh')
  })

  // 留在中文模式但已沒有 zh-TW 聲音，播放鈕會變成永遠無法使用；回到英文才能繼續朗讀。
  it('中文朗讀中 zh-TW 聲音從清單消失時，停止朗讀、清除高亮並回到英文', () => {
    const engine = createFakeSpeechEngine([enUS, zhTW])
    const { narration } = setup({ engine })
    narration.setLanguage('zh')
    narration.toggle('p0-s0', s0)
    const cancelsBefore = engine.cancelCount

    engine.voices = [enUS]
    engine.emitVoicesChanged()

    expect(engine.cancelCount).toBe(cancelsBefore + 1)
    expect(narration.activeId.value).toBeNull()
    expect(narration.language.value).toBe('en')
    expect(narration.chineseAvailable.value).toBe(false)
  })

  // 與上面「朗讀中英文聲音消失」對照：只有目前語言的聲音消失才停止，中文朗讀不因英文聲音消失而中斷。
  it('中文朗讀中英文聲音消失時，中文朗讀不中斷', () => {
    const engine = createFakeSpeechEngine([enUS, zhTW])
    const { narration } = setup({ engine })
    narration.setLanguage('zh')
    narration.toggle('p0-s0', s0)
    const cancelsBefore = engine.cancelCount

    engine.voices = [zhTW]
    engine.emitVoicesChanged()

    expect(narration.availability.value).toBe('no-english-voice')
    expect(narration.activeId.value).toBe('p0-s0')
    expect(engine.cancelCount).toBe(cancelsBefore)
  })

  it('聲音清單還沒載入時中文不可選，載入 zh-TW 後才可選', () => {
    const engine = createFakeSpeechEngine([])
    const { narration } = setup({ engine })
    narration.setLanguage('zh')
    expect(narration.chineseAvailable.value).toBe(false)
    expect(narration.language.value).toBe('en')

    engine.voices = [zhTW]
    engine.emitVoicesChanged()
    narration.setLanguage('zh')

    expect(narration.chineseAvailable.value).toBe(true)
    expect(narration.language.value).toBe('zh')
  })

  it('瀏覽器沒有 speechSynthesis 時中文不可選', () => {
    const { narration } = setup({ engine: null })
    narration.setLanguage('zh')
    expect(narration.chineseAvailable.value).toBe(false)
    expect(narration.language.value).toBe('en')
    expect(narration.canPlay.value).toBe(false)
  })
})
