/**
 * 参加者の「1回分の回答」を録音し、サーバー（Whisper）で文字起こしする。
 *
 * ## なぜブラウザ内蔵の音声認識を使わないのか
 *
 * Web Speech API は動く環境が限られる。Brave は Google の音声認識サービスを
 * 意図的に無効化しているため必ず `network` エラーになり、社内ネットワークや
 * プロキシが同じエンドポイントを遮断していることもある。参加者は社外の人で、
 * ブラウザも回線もこちらでは選べない以上、そこに依存すると「一部の参加者だけ
 * 黙って回答が取れない」状態を避けられない（実際にそうなっていた）。
 *
 * ## 終わりの判定
 *
 * 録音方式では「話し終えた」をブラウザが教えてくれないので、こちらで見る。
 * 音量（RMS）を監視し、一度話し始めたあと無音が一定時間続いたら自動で締める。
 * 自動判定に頼り切らず、呼び出し側は `finishNow()`（「話し終えました」ボタン）も
 * 出せるようにしてある。
 */

export type AnswerRecorder = {
  /** 参加者が「話し終えました」を押したときなど、その場で締める */
  finishNow: () => void
  /** 破棄する（次の質問へ進む・面談終了など）。コールバックは呼ばれない */
  stop: () => void
}

export type AnswerRecorderOptions = {
  /** 録音に使うマイク。呼び出し側が既に取得しているものを渡す */
  stream: MediaStream
  /** 話し始めるのを待つ上限。これを過ぎたら onSilence */
  silenceMs?: number
  /** 話し始めたあと、この時間だけ静かなら話し終えたとみなす */
  trailingSilenceMs?: number
  /** 録音中かどうかが変わった */
  onRecordingChange: (recording: boolean) => void
  /** 参加者が話し出したことを検知した（画面表示の切り替え用） */
  onSpeechDetected: () => void
  /** 文字起こし中 */
  onTranscribing: () => void
  /** 回答が確定した。1回だけ呼ばれる */
  onFinal: (text: string) => void
  /** 一度も話さないまま時間が過ぎた。1回だけ呼ばれる */
  onSilence: () => void
  /** 録音も文字起こしもできなかった。1回だけ呼ばれる */
  onGiveUp: (reason: string) => void
}

/** 発話とみなす音量のしきい値（RMS）。小さすぎると環境音を拾う */
const SPEECH_RMS_THRESHOLD = 0.015

export function startAnswerRecorder(opts: AnswerRecorderOptions): AnswerRecorder | null {
  const audioTrack = opts.stream.getAudioTracks()[0]
  if (!audioTrack) return null

  const silenceMs = opts.silenceMs ?? 60000
  const trailingSilenceMs = opts.trailingSilenceMs ?? 2500

  let finished = false
  let stopped = false
  let speechDetected = false
  let lastLoudAt = 0
  const startedAt = Date.now()

  let recorder: MediaRecorder | null = null
  const chunks: Blob[] = []
  let audioContext: AudioContext | null = null
  let levelTimer: ReturnType<typeof setInterval> | null = null
  let watchTimer: ReturnType<typeof setInterval> | null = null

  function cleanup() {
    if (watchTimer) {
      clearInterval(watchTimer)
      watchTimer = null
    }
    if (levelTimer) {
      clearInterval(levelTimer)
      levelTimer = null
    }
    try {
      audioContext?.close()
    } catch {
      // 既に閉じている
    }
    audioContext = null
  }

  function finish(notify: () => void) {
    if (finished) return
    finished = true
    cleanup()
    // 録音は必ず止める。止め忘れると、無音で打ち切るたびに止まらない
    // MediaRecorder が増え、マイクを掴んだままメモリを食い続ける
    void stopRecorder()
    opts.onRecordingChange(false)
    notify()
  }

  /** 録音を止めて音声を取り出す */
  function stopRecorder(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const rec = recorder
      recorder = null
      if (!rec || rec.state === 'inactive') {
        resolve(chunks.length ? new Blob(chunks, { type: chunks[0].type }) : null)
        return
      }
      rec.onstop = () => {
        resolve(chunks.length ? new Blob(chunks, { type: chunks[0].type }) : null)
      }
      try {
        rec.stop()
      } catch {
        resolve(chunks.length ? new Blob(chunks, { type: chunks[0].type }) : null)
      }
    })
  }

  async function concludeWithTranscription() {
    if (finished) return
    cleanup()
    opts.onRecordingChange(false)
    opts.onTranscribing()
    const blob = await stopRecorder()
    if (stopped || finished) return
    if (!blob || blob.size === 0) {
      finish(() => opts.onSilence())
      return
    }
    try {
      const res = await fetch('/api/transcribe-answer', {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'audio/webm' },
        body: blob,
      })
      if (stopped || finished) return
      if (!res.ok) {
        finish(() => opts.onGiveUp(`transcribe:${res.status}`))
        return
      }
      const data = (await res.json()) as { text?: string }
      const text = (data.text ?? '').trim()
      if (stopped || finished) return
      // 無音を録っただけだと Whisper は空や意味の無い短い文字を返すことがある。
      // 空なら「話さなかった」として扱い、聞き直しの導線へ回す
      if (!text) {
        finish(() => opts.onSilence())
        return
      }
      finish(() => opts.onFinal(text))
    } catch {
      if (stopped || finished) return
      finish(() => opts.onGiveUp('transcribe:network'))
    }
  }

  // ── 録音 ──
  try {
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
      .find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
    // 映像トラックを含めないよう、音声だけの MediaStream を作る
    const audioOnly = new MediaStream([audioTrack])
    recorder = new MediaRecorder(audioOnly, mimeType ? { mimeType } : {})
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    recorder.start(1000)
  } catch {
    return null
  }
  opts.onRecordingChange(true)

  // ── 音量の監視（話し始め／話し終わりの判定） ──
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    audioContext = new Ctx()
    const source = audioContext.createMediaStreamSource(opts.stream)
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)
    const buf = new Float32Array(analyser.fftSize)

    // requestAnimationFrame は使わない。**裏に回ったタブでは実行されない**ため、
    // 参加者が別のタブを見ている間は発話をまったく検知できなくなる（実際にそれで
    // 回答が1問も取れない状態になった）。setInterval なら間隔は粗くなるが動き続ける。
    levelTimer = setInterval(() => {
      if (finished || stopped) return
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const rms = Math.sqrt(sum / buf.length)
      if (rms >= SPEECH_RMS_THRESHOLD) {
        lastLoudAt = Date.now()
        if (!speechDetected) {
          speechDetected = true
          opts.onSpeechDetected()
        }
      }
    }, 100)
  } catch {
    // 音量を見られない環境では自動の締めができない。
    // 「話し終えました」ボタンと沈黙タイムアウトだけで進める
  }

  watchTimer = setInterval(() => {
    if (finished || stopped) return
    const now = Date.now()
    if (speechDetected) {
      // 話し始めたあと、静かな時間が続いたら話し終えたとみなす
      if (lastLoudAt && now - lastLoudAt >= trailingSilenceMs) void concludeWithTranscription()
      return
    }
    // 一度も話し出さないまま時間切れ。小さな声で音量判定に届かなかっただけの
    // 可能性があるので、録れている音声があれば捨てずに文字起こしを試す
    if (now - startedAt >= silenceMs) void concludeWithTranscription()
  }, 250)

  return {
    finishNow: () => {
      if (finished || stopped) return
      if (!speechDetected) {
        // 何も話していないのに押された場合も、録音を捨てずに文字起こしを試す
        // （小さな声で話していて音量判定に届かなかった可能性がある）
        speechDetected = true
      }
      void concludeWithTranscription()
    },
    stop: () => {
      if (stopped || finished) return
      stopped = true
      cleanup()
      void stopRecorder()
      opts.onRecordingChange(false)
    },
  }
}
