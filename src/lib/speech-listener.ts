/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 音声認識（Web Speech API）の扱いにくい部分を1か所にまとめたモジュール。
 *
 * メイン画面と小窓の両方が「参加者の回答を聞き取る」必要があるが、実装を2か所に
 * 置くと必ず片方だけ直して挙動がズレる。ここを唯一の実装にする。
 *
 * ## 設計の要点（すべて実際に起きた不具合への対処）
 *
 * 1. **聞き取り1回につき、状態を持つオブジェクトを1つ作る**。
 *    以前はモジュール横断の ref に「停止中フラグ」「現在のインスタンス」を持たせて
 *    いたため、前の質問の認識が遅れてイベントを出すと、次の質問の状態を書き換えて
 *    しまっていた（回答の入れ替わり・二重送信・無関係なエラー表示の原因）。
 *    今は各リスナーが自分のインスタンスだけを見る（`recognition !== current` で判定）。
 *
 * 2. **再試行の上限は「連続した失敗」だけを数える**。
 *    ブラウザは `continuous = true` でも長い発話の途中で認識を区切って終了する。
 *    これを失敗として数えると、長く話す人ほど早く上限に達し、発話の最中に
 *    「中断しました」が出る。一定時間動けていた終了・結果が返った終了は失敗に
 *    数えず、待たずに再開する（待つとその間の発話が失われる）。
 *
 * 3. **エラーの種類で「もう直らない」と即断しない**。
 *    一過性のブロックと恒久的な拒否は、短い再試行が全部空振りしたかどうかで
 *    区別する。ただしエラーで終わったインスタンスは、何秒動いていても
 *    「正常な終了」には数えない（数えると予算が減らず永久に再開し続ける）。
 *
 * 4. **聞き取れた分を捨てない**。沈黙が続いたときも、認識を諦めるときも、
 *    それまでに確定したテキストを呼び出し側へ必ず渡す。
 */

export type SpeechListener = {
  /** 外部から終了させる（次の質問へ進む・面談終了など）。コールバックは呼ばれない */
  stop: () => void
  /** ここまでに確定している聞き取り結果 */
  getPartial: () => string
}

export type SpeechListenerOptions = {
  lang?: string
  /** 何も聞こえないまま経過したら打ち切る時間 */
  silenceMs?: number
  /** 聞き取り中の文字（確定分＋認識中の分）が変わった */
  onLiveText: (text: string) => void
  /** 聞き取り中かどうかが変わった */
  onListeningChange: (listening: boolean) => void
  /** 発話が終わり、回答が確定した。1回だけ呼ばれる */
  onFinal: (text: string) => void
  /** 何も聞き取れないまま沈黙が続いた。1回だけ呼ばれる */
  onSilence: () => void
  /**
   * 認識を続けられなくなった。1回だけ呼ばれる。
   * partial には聞き取れていた分、reason には原因（ブラウザのエラー種別、または
   * 一度も開始できなかったことを示す 'not-started'）が入る。
   * 原因が分からないと現場で手の打ちようがないため、必ず表に出せるようにしておく。
   */
  onGiveUp: (partial: string, reason: string) => void
}

function getSpeechRecognitionCtor(): (new () => any) | undefined {
  if (typeof window === 'undefined') return undefined
  return ((window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition) as (new () => any) | undefined
}

/** この環境で音声認識が使えるか（使えなければ呼び出し側はテキスト入力に頼る） */
export function isSpeechRecognitionSupported(): boolean {
  return !!getSpeechRecognitionCtor()
}

/**
 * 聞き取りを開始する。開始できなければ null（呼び出し側はテキスト入力で続行する）。
 *
 * onFinal / onSilence / onGiveUp のいずれか1つだけが、高々1回呼ばれる。
 */
export function startSpeechListener(opts: SpeechListenerOptions): SpeechListener | null {
  const SR = getSpeechRecognitionCtor()
  if (!SR) return null

  const lang = opts.lang ?? 'ja-JP'
  const silenceMs = opts.silenceMs ?? 60000
  /** 連続して「動けないまま終わった」回数の上限 */
  const MAX_RESTART_ATTEMPTS = 5
  /** この時間以上動いていた認識は「正常に動いていた」と見なす */
  const HEALTHY_RUN_MS = 3000

  let finalText = ''
  /** 結果を1つ通知し終えたか（onFinal / onSilence / onGiveUp は合わせて1回だけ） */
  let finished = false
  /** 外部から stop() されたか */
  let stopped = false
  let restartAttempts = 0
  let current: any = null
  let silenceTimer: ReturnType<typeof setTimeout> | null = null
  /** 直近の失敗理由（諦めるときに呼び出し側へ渡す） */
  let lastErrorCode = ''
  /** 一度でも認識が実際に始まったか。始まってすらいないなら環境側で塞がれている */
  let everStarted = false

  function clearSilenceTimer() {
    if (silenceTimer) {
      clearTimeout(silenceTimer)
      silenceTimer = null
    }
  }

  /** 今のインスタンスだけを止める（沈黙タイマーは触らない） */
  function abortInstance() {
    const recognition = current
    current = null
    if (!recognition) return
    try {
      recognition.abort()
    } catch {
      try {
        recognition.stop()
      } catch {
        // 既に停止している。実害は無い
      }
    }
  }

  /**
   * 沈黙タイムアウトを張り直す。
   *
   * 「解除」ではなく「張り直し」なのが要点。解除だけだと、一度何か声を出した時点で
   * 安全網が永久に外れ、そのあと認識が空回りしても誰も気づけない。
   */
  function armSilenceTimer() {
    clearSilenceTimer()
    silenceTimer = setTimeout(() => {
      if (finished || stopped) return
      // 聞き取れている分があるなら、それを回答として確定する。捨てて聞き直すと
      // 話した内容がまるごと消える
      if (finalText.trim()) {
        finish(() => opts.onFinal(finalText.trim()))
        return
      }
      finish(() => opts.onSilence())
    }, silenceMs)
  }

  /** 諦めた原因。現場から報告してもらうために、そのまま画面へ出せる短い文字列にする */
  function giveUpReason(): string {
    if (!everStarted) return lastErrorCode ? `not-started:${lastErrorCode}` : 'not-started'
    return lastErrorCode || 'unknown'
  }

  /** 結果を1つだけ通知して終了する */
  function finish(notify: () => void) {
    if (finished) return
    finished = true
    clearSilenceTimer()
    abortInstance()
    opts.onListeningChange(false)
    notify()
  }

  function scheduleRestart(delayMs: number) {
    setTimeout(() => {
      if (finished || stopped) return
      try {
        abortInstance() // 念のため：前のインスタンスを残さない
        current = createRecognition()
        current.start()
      } catch {
        // start() が例外を投げた場合、このインスタンスは onend も onerror も出さない。
        // ここで面倒を見ないと、再試行も通知も無いまま無音で完全に止まる
        restartAttempts++
        lastErrorCode = lastErrorCode || 'start-failed'
        if (restartAttempts > MAX_RESTART_ATTEMPTS) {
          finish(() => opts.onGiveUp(finalText.trim(), giveUpReason()))
        } else {
          scheduleRestart(500)
        }
      }
    }, delayMs)
  }

  function createRecognition(): any {
    const recognition: any = new SR!()
    recognition.lang = lang
    recognition.continuous = true
    recognition.interimResults = true

    // このインスタンス固有の状態。リスナー側に置くと前のインスタンスの値が混ざる
    let startedAt = 0
    let errored = false
    let stoppingFromSpeechEnd = false

    recognition.onstart = () => {
      startedAt = Date.now()
      everStarted = true
    }

    recognition.onresult = (event: any) => {
      // 取り込みは常に行う。stop() のあとに末尾の確定結果が届くことがあり、
      // ここで捨てると参加者の言い終わりが欠ける
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript
        } else {
          interim = event.results[i][0].transcript
        }
      }
      if (finished || stopped) return
      // 実際に聞き取れている＝認識は正常に動いている
      armSilenceTimer()
      restartAttempts = 0
      opts.onLiveText(finalText + interim)
    }

    recognition.onspeechend = () => {
      if (finished || stopped) return
      stoppingFromSpeechEnd = true
      try {
        recognition.stop()
      } catch {
        // 既に停止している
      }
      // 確定結果がまだ届いていないことがある。その場合は onend 側で拾う
      if (finalText.trim()) finish(() => opts.onFinal(finalText.trim()))
    }

    recognition.onerror = (e: any) => {
      // no-speech / aborted は沈黙タイマーや通常停止で処理されるため無視
      if (e?.error === 'no-speech' || e?.error === 'aborted') return
      // 再開処理はここに書かない（error のあとは onend も必ず発火するため、
      // ここで start() すると二重起動になる）
      errored = true
      lastErrorCode = String(e?.error ?? 'unknown')
      console.warn('[UserVoice] 音声認識エラー', lastErrorCode)
    }

    recognition.onend = () => {
      if (finished || stopped) return
      // 既に別のインスタンスへ切り替わっているなら、これは古いインスタンスの
      // 遅れて届いた終了通知。今の聞き取りに干渉させない
      if (recognition !== current) return

      if (stoppingFromSpeechEnd) {
        stoppingFromSpeechEnd = false
        if (finalText.trim()) {
          finish(() => opts.onFinal(finalText.trim()))
          return
        }
        // 発話の終わりと判定されたのに確定結果が無かった（物音だけ拾った等）。
        // ここで止まると参加者は話しても進めない状態で固まるので聞き取りを続ける
        restartAttempts++
        if (restartAttempts > MAX_RESTART_ATTEMPTS) {
          finish(() => opts.onGiveUp(finalText.trim(), giveUpReason()))
          return
        }
        armSilenceTimer()
        scheduleRestart(0)
        return
      }

      // ブラウザは長い発話の途中でも認識を区切って終了する。しばらく動けていたなら
      // 異常ではないので連続失敗に数えず、待たずに再開する。エラーで終わった場合は
      // 何秒動いていても正常には数えない（数えないと予算が減らず永久に再開し続ける）
      const ranMs = startedAt ? Date.now() - startedAt : 0
      const healthy = ranMs >= HEALTHY_RUN_MS && !errored
      if (healthy) restartAttempts = 0
      else restartAttempts++

      if (restartAttempts > MAX_RESTART_ATTEMPTS) {
        finish(() => opts.onGiveUp(finalText.trim(), giveUpReason()))
        return
      }
      scheduleRestart(healthy ? 0 : 500)
    }

    return recognition
  }

  armSilenceTimer()
  try {
    current = createRecognition()
    current.start()
  } catch {
    clearSilenceTimer()
    return null
  }
  opts.onListeningChange(true)

  return {
    stop: () => {
      if (stopped || finished) return
      stopped = true
      clearSilenceTimer()
      abortInstance()
      opts.onListeningChange(false)
    },
    getPartial: () => finalText.trim(),
  }
}
