import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { createFakeSpeechEngine, enUS, zhTW } from './fakeSpeechEngine'
import { useNarration, type NarrationOptions } from './useNarration'

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

    narration.toggle('p0-s0', 'Dino has a new backpack.')

    expect(narration.availability.value).toBe('unsupported')
    expect(narration.activeId.value).toBeNull()
  })

  it('聲音清單只有非英文聲音時標為沒有英文聲音，按播放不送出朗讀', () => {
    const engine = createFakeSpeechEngine([zhTW])
    const { narration } = setup({ engine })

    narration.toggle('p0-s0', 'Dino has a new backpack.')

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
    narration.toggle('p0-s0', 'Dino has a new backpack.')

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

    narration.toggle('p0-s0', 'Dino has a new backpack.')

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
    narration.toggle('p0-s0', 'Dino has a new backpack.')
    const cancelsBeforePause = engine.cancelCount

    narration.toggle('p0-s0', 'Dino has a new backpack.')

    expect(engine.cancelCount).toBe(cancelsBeforePause + 1)
    expect(narration.activeId.value).toBeNull()
    expect(engine.spoken).toHaveLength(1)

    narration.toggle('p0-s0', 'Dino has a new backpack.')
    expect(engine.spoken).toHaveLength(2)
    expect(narration.activeId.value).toBe('p0-s0')
  })

  // 同時只能播一句：播第二句前必須先 cancel，否則 speechSynthesis 會把第二句排在第一句後面。
  it('播第一句時改播第二句，會先取消第一句再朗讀第二句，只有第二句高亮', () => {
    const engine = createFakeSpeechEngine([enUS])
    const { narration } = setup({ engine })
    narration.toggle('p0-s0', 'Dino has a new backpack.')
    const cancelsBeforeSecond = engine.cancelCount

    narration.toggle('p0-s1', 'Today is his first day of school.')

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
    narration.toggle('p0-s0', 'Dino has a new backpack.')
    narration.toggle('p0-s1', 'Today is his first day of school.')

    engine.spoken[0]!.events.onError()
    engine.spoken[0]!.events.onEnd()

    expect(narration.activeId.value).toBe('p0-s1')
  })

  it('目前句子念完時清除高亮', () => {
    const engine = createFakeSpeechEngine([enUS])
    const { narration } = setup({ engine })
    narration.toggle('p0-s0', 'Dino has a new backpack.')

    engine.spoken[0]!.events.onEnd()

    expect(narration.activeId.value).toBeNull()
  })

  it('目前句子朗讀出錯時清除高亮並回到可播放，再按一次會重新朗讀', () => {
    const engine = createFakeSpeechEngine([enUS])
    const { narration } = setup({ engine })
    narration.toggle('p0-s0', 'Dino has a new backpack.')

    engine.spoken[0]!.events.onError()

    expect(narration.activeId.value).toBeNull()
    expect(narration.availability.value).toBe('ready')
    narration.toggle('p0-s0', 'Dino has a new backpack.')
    expect(engine.spoken).toHaveLength(2)
    expect(narration.activeId.value).toBe('p0-s0')
  })

  it('stop() 取消朗讀並清除高亮', () => {
    const engine = createFakeSpeechEngine([enUS])
    const { narration } = setup({ engine })
    narration.toggle('p0-s0', 'Dino has a new backpack.')
    const cancelsBeforeStop = engine.cancelCount

    narration.stop()

    expect(engine.cancelCount).toBe(cancelsBeforeStop + 1)
    expect(narration.activeId.value).toBeNull()
  })

  // 元件卸載後若沒取消，瀏覽器會繼續念完已排入的句子，且 listener 留著會持有已卸載的狀態。
  it('所屬的 effect scope 結束時取消朗讀並移除 voiceschanged listener', () => {
    const engine = createFakeSpeechEngine([enUS])
    const { scope, narration } = setup({ engine })
    narration.toggle('p0-s0', 'Dino has a new backpack.')
    expect(engine.listenerCount()).toBe(1)
    const cancelsBeforeDispose = engine.cancelCount

    scope.stop()

    expect(engine.cancelCount).toBe(cancelsBeforeDispose + 1)
    expect(engine.listenerCount()).toBe(0)
  })
})
