'use client'

import { useEffect, useState, useRef, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Monitor, Check, X, AlertTriangle, CheckCircle2, Globe, Volume2, Mic } from 'lucide-react'
import SeqScale from '@/components/SeqScale'
import StuckHelp from '@/components/StuckHelp'
import TaskRecovery, { TaskRecoveryActions } from '@/components/TaskRecovery'
import ThinkAloudNudge from '@/components/ThinkAloudNudge'
import { blockedAfter, needsRecovery } from '@/lib/task-flow'
import { useSilenceNudge } from '@/hooks/useSilenceNudge'
import RatingQuestion from '@/components/RatingQuestion'
import NpsQuestion from '@/components/NpsQuestion'
import { startAnswerRecorder, type AnswerRecorder } from '@/lib/answer-recorder'

interface Task {
  text: string
  order: number
  /**
   * 詰まったときに見せるヒント（リサーチャーが事前に書いたもの）。
   * isPrerequisite のタスクでは、断念した人を次の開始地点まで案内する手順も兼ねる。
   */
  hint?: string | null
  /** このタスクの結果が次のタスクの前提になるか（断念しても即座に次へ進めない） */
  isPrerequisite?: boolean | null
}

// 'interview' = タスクが全部終わったあとの事後質問。
// メイン画面ではなく小窓で行う。理由は2つで、(1) 画面録画は小窓が持っているため
// 小窓を閉じると事後質問がまったく記録されない、(2) 参加者が見ているのは常に手前に
// ある小窓で、裏側になったメイン画面ではブラウザが音声認識を止めてしまう。
type WidgetPhase = 'task' | 'interview' | 'done'

function WidgetContent() {
  const searchParams = useSearchParams()
  const sessionId  = searchParams.get('session')  ?? ''
  const tasksRaw   = searchParams.get('tasks')    ?? 'W10='
  const initialIdx = parseInt(searchParams.get('current') ?? '0', 10)
  const stimulusUrl = searchParams.get('stimulus') ?? ''
  const seqEnabled  = searchParams.get('seq') === '1'
  // 詰まった参加者への声かけまでの秒数。0 / 未指定なら声かけしない
  const hintDelaySec = Number(searchParams.get('hintdelay') ?? '0') || 0

  // タスクは URL パラメータから決まるので state に持たない（effect での setState も不要になる）
  const tasks = useMemo<Task[]>(() => {
    try { return JSON.parse(decodeURIComponent(atob(tasksRaw))) } catch { return [] }
  }, [tasksRaw])
  const [currentTaskIndex, setCurrentTaskIndex] = useState(initialIdx)
  const [widgetPhase, setWidgetPhase]           = useState<WidgetPhase>('task')
  const [doneMessage, setDoneMessage]           = useState('')
  const [isScreenRecording, setIsScreenRecording] = useState(false)
  const [serviceOpened, setServiceOpened]       = useState(false)
  const [warnNoRecord, setWarnNoRecord]         = useState(false)
  // SEQ 入力待ちの結果（達成/断念を押した直後、評価を受け取るまで保持）
  const [awaitingSeq, setAwaitingSeq]           = useState<'completed' | 'gave_up' | null>(null)
  const [cameraError, setCameraError]           = useState(false)
  // 顔フレーミング判定: null=判定前 / 'ok'=正常 / 'no_face'=写っていない / 'cut_off'=見切れ
  const [faceStatus, setFaceStatus]             = useState<'ok' | 'no_face' | 'cut_off' | null>(null)
  // 詰まった参加者への声かけ。
  // 「どのタスクで出したか」を持ち、現在のタスクと一致するときだけ表示する。
  // こうするとタスクが変わった瞬間に自動で引っ込むので、effect でリセットしなくてよい
  // （effect 内で同期的に setState すると連鎖レンダーの原因になる）。
  const [stuckAtIdx, setStuckAtIdx]             = useState<number | null>(null)
  const [hintShownAtIdx, setHintShownAtIdx]     = useState<number | null>(null)
  // 前提タスクを断念した直後の立て直し待ち。stuckAtIdx と同じく「どのタスクで出したか」
  // を持つので、タスクが進めば自動で引っ込む。
  // 小窓を閉じて開き直した場合も引き継ぐ（メイン側が recovery=1 を付けて開く）。
  // 引き継がないと通常の「達成／できなかった」が出て、断念の記録が上書きされる。
  const [recoveryAtIdx, setRecoveryAtIdx]       = useState<number | null>(
    searchParams.get('recovery') === '1' ? initialIdx : null,
  )
  // 思考発話の促し。沈黙検知で出し、しばらくして自動で消す（状態ではなく合図なので残さない）
  const [thinkAloudNudge, setThinkAloudNudge]   = useState(false)
  // 沈黙検知用のマイクストリーム（ref だと effect を張り直せないので state で持つ）
  const [micStream, setMicStream]              = useState<MediaStream | null>(null)
  // メイン画面が読み上げ中か（tts_state で届く）。読み上げ中は沈黙検知を止める
  const [ttsSpeaking, setTtsSpeaking]          = useState(false)
  // 読み上げに合わせて少しずつ表示する文字列（タイプライター表示）。
  // メイン側の speak() が唯一の情報源（tts_reveal で届く）
  const [revealedText, setRevealedText]        = useState('')
  // タスク1の前に読む思考発話の案内。メイン側から guidance_text で届くまでは
  // プレースホルダーを出す（案内のテキストはメイン側の speak() が唯一の情報源）
  const [guidanceText, setGuidanceText]        = useState('')
  // 案内の「スタート」を押したか。押すまではタスク1の文言・結果ボタンを出さない
  // （案内を読み終える前にタスクが見えてしまう不具合の修正）
  const [guidanceDismissed, setGuidanceDismissed] = useState(false)
  // ── 事後質問（widgetPhase === 'interview'）の状態 ──
  const [question, setQuestion]                 = useState('')
  const [questionType, setQuestionType]         = useState<'open' | 'rating' | 'nps'>('open')
  const [liveText, setLiveText]                 = useState('')
  const [isListening, setIsListening]           = useState(false)
  const [aiThinking, setAiThinking]             = useState(false)
  const [answerInput, setAnswerInput]           = useState('')
  const [listenNotice, setListenNotice]         = useState('')
  // 聞き取りを諦めた原因（ブラウザのエラー種別）。原因の切り分けに使う
  const [listenReason, setListenReason]         = useState('')
  // 最後に受け取った listen_start の再試行フラグ（「もう一度話す」で使う）
  const listenRetryRef                          = useRef(false)
  const listenerRef                             = useRef<AnswerRecorder | null>(null)
  // 文字起こし中（送信して返事を待っている）
  const [transcribing, setTranscribing]         = useState(false)
  // 参加者が話し出したことを検知したか（「話し終えました」を出す目安）
  const [speechHeard, setSpeechHeard]           = useState(false)
  // ヒントを見たタスク番号（0始まり）。結果送信時に添えて集計で自力達成と分ける
  const usedHintIdxRef                          = useRef<Set<number>>(new Set())

  const channelRef             = useRef<BroadcastChannel | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const faceApiRef             = useRef<any>(null)
  const webcamVideoRef         = useRef<HTMLVideoElement>(null)
  const webcamStreamRef        = useRef<MediaStream | null>(null)
  const screenMediaRecorderRef = useRef<MediaRecorder | null>(null)
  const screenChunksRef        = useRef<Blob[]>([])
  const screenStreamRef        = useRef<MediaStream | null>(null)
  const animFrameRef           = useRef<number>(0)

  /* ── 初期化 ─────────────────────────────────────────────── */
  useEffect(() => {
    // BroadcastChannel
    if (sessionId) {
      const channel = new BroadcastChannel(`uservoice-widget-${sessionId}`)
      channelRef.current = channel
      channel.onmessage = (e) => {
        const { type } = e.data
        if (type === 'task_update' && typeof e.data.currentTaskIndex === 'number') {
          const next = e.data.currentTaskIndex
          setCurrentTaskIndex(next)
          // 立て直し待ちの持ち主はメイン側（記録を持っている方）。メインが別タスクへ
          // 移った時点で待ちは解除されているので、小窓にも残さない。残すと元のタスクへ
          // 戻ったときだけ小窓が立て直し画面を復活させ、押してもメインが受け取らない
          // （無反応のうえ小窓とメインで現在タスクがズレる）。
          setRecoveryAtIdx((cur) => (cur === next ? cur : null))
        } else if (type === 'tts_state') {
          setTtsSpeaking(e.data.speaking === true)
        } else if (type === 'tts_reveal' && typeof e.data.text === 'string') {
          setRevealedText(e.data.text)
        } else if (type === 'guidance_text' && typeof e.data.text === 'string') {
          setGuidanceText(e.data.text)
        } else if (type === 'prereq_recovery' && typeof e.data.index === 'number') {
          // メイン画面側で前提タスクの断念が記録された（フォールバック操作時）。
          // 小窓でも同じ立て直し画面を出し、操作の起点が割れないようにする
          setRecoveryAtIdx(e.data.index)
        } else if (type === 'post_interview_start') {
          // タスクは全部終わった。ここから事後質問を小窓の中で行う。
          // 録画はまだ止めない（事後質問のやり取りも記録に残す）
          stopListening()
          setWidgetPhase('interview')
          setQuestion('')
          setLiveText('')
          setAnswerInput('')
          setListenNotice('')
        } else if (type === 'interview_question') {
          setQuestion(typeof e.data.text === 'string' ? e.data.text : '')
          const qt = e.data.questionType
          setQuestionType(qt === 'rating' || qt === 'nps' ? qt : 'open')
          setLiveText('')
          setAnswerInput('')
          setListenNotice('')
          setListenReason('')
        } else if (type === 'answer_ack') {
          if (e.data.accepted === true) {
            // 受け取られた分だけ入力欄から消す（そのあと打ち足した分は残す）
            setAnswerInput((prev) => (prev.trim() === String(e.data.text ?? '').trim() ? '' : prev))
          } else {
            setListenNotice('前の質問に進んでいたため送れませんでした。次の質問にお答えください。')
          }
        } else if (type === 'ai_thinking') {
          setAiThinking(e.data.thinking === true)
        } else if (type === 'listen_start') {
          beginListening(e.data.silenceRetry === true)
        } else if (type === 'listen_stop') {
          stopListening()
        } else if (type === 'session_ended') {
          // 面談終了。録画を止めて書き出し、メインへ渡してから閉じる。
          // 先に閉じると録画が丸ごと失われる
          stopListening()
          setWidgetPhase('done')
          setDoneMessage('録画を保存しています...')
          void (async () => {
            await stopAndSendRecording()
            setDoneMessage('ウィンドウを閉じています...')
            setTimeout(() => window.close(), 800)
          })()
        }
      }
    }

    // ウェブカメラ（表示＋音声。音声は合成録画に載せる）
    initWebcam()

    return () => {
      channelRef.current?.close()
      channelRef.current = null
      webcamStreamRef.current?.getTracks().forEach((t) => t.stop())
      screenStreamRef.current?.getTracks().forEach((t) => t.stop())
      cancelAnimationFrame(animFrameRef.current)
      if (screenMediaRecorderRef.current?.state !== 'inactive') {
        screenMediaRecorderRef.current?.stop()
      }
    }
  }, [sessionId, tasksRaw])

  /* ── ウェブカメラ取得（失敗時はフォールバック表示 + 再試行） ── */
  function initWebcam() {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        webcamStreamRef.current = stream
        if (webcamVideoRef.current) {
          webcamVideoRef.current.srcObject = stream
        }
        setCameraError(false)
        // 沈黙検知のフックは ref の更新では張り直せないので state にも持つ
        setMicStream(stream)
      })
      .catch(() => { setCameraError(true) })
  }

  /* ── 顔検出モデル（tiny_face_detector のみ）をロード。補助機能なので失敗しても録画は継続 ── */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (typeof window === 'undefined') return
      try {
        const faceapi = await import('@vladmandic/face-api')
        await faceapi.nets.tinyFaceDetector.loadFromUri('/models')
        if (!cancelled) faceApiRef.current = faceapi
      } catch (err) {
        console.warn('[Widget] 顔検出モデルのロードに失敗（顔フレーミング判定は無効）:', err)
      }
    })()
    return () => { cancelled = true }
  }, [])

  /* ── 顔フレーミング判定ループ: 数秒ごとに顔の有無と見切れ（画面端に接触）を判定 ── */
  useEffect(() => {
    const interval = setInterval(async () => {
      const faceapi = faceApiRef.current
      const video = webcamVideoRef.current
      if (!faceapi || !video || cameraError || video.readyState < 2 || !video.videoWidth) return
      try {
        const det = await faceapi.detectSingleFace(
          video,
          new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.3 }),
        )
        if (!det) { setFaceStatus('no_face'); return }
        const { x, y, width, height } = det.box
        const vw = video.videoWidth
        const vh = video.videoHeight
        // 端に接していたら「見切れ」。マージンは映像サイズの約1.5%（最低6px）。
        const mx = Math.max(6, vw * 0.015)
        const my = Math.max(6, vh * 0.015)
        const cut = x <= mx || y <= my || (x + width) >= (vw - mx) || (y + height) >= (vh - my)
        setFaceStatus(cut ? 'cut_off' : 'ok')
      } catch {
        // フレームが取れない等は無視
      }
    }, 2500)
    return () => clearInterval(interval)
  }, [cameraError])

  /* ── 画面録画開始（Canvas合成: スクリーン + ウェブカメラPiP） ── */
  async function startScreenRecording() {
    try {
      // displaySurface:'monitor' で「画面全体」をダイアログの既定に寄せる。
      // どのタブを操作してもサービスが確実に録画対象に含まれ、参加者がタブを選び間違えない。
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor' }, audio: false })
      screenStreamRef.current = screenStream
      screenChunksRef.current = []

      // スクリーン用 offscreen video を作成・再生
      const screenVid = document.createElement('video')
      screenVid.srcObject = screenStream
      screenVid.muted = true
      await new Promise<void>((resolve) => {
        screenVid.onloadedmetadata = () => {
          screenVid.play().then(resolve).catch(resolve)
        }
      })

      // Canvas サイズはスクリーン解像度（上限 1920×1080）
      const W = Math.min(screenVid.videoWidth  || 1280, 1920)
      const H = Math.min(screenVid.videoHeight || 720,  1080)
      const canvas = document.createElement('canvas')
      canvas.width  = W
      canvas.height = H
      const ctx = canvas.getContext('2d')!

      // ウェブカメラ PiP の合成はしない。「画面全体」共有では、常に最前面の小窓自体が
      // カメラ映像を映したまま画面キャプチャに写り込む。ここでさらに合成すると、
      // 同じ顔が小窓とワイプの2箇所に写る（実際に起きた不具合。DECISIONS 参照）。
      // 描画ループは画面のみだが、キャンバス経由にすることで解像度上限（1920×1080）と
      // 一定フレームレートを保つ（高DPI画面でファイルが肥大化するのを防ぐ）。
      function draw() {
        ctx.drawImage(screenVid, 0, 0, W, H)
        animFrameRef.current = requestAnimationFrame(draw)
      }
      draw()

      // Canvas ストリームを録画
      const canvasStream = canvas.captureStream(25)
      // マイク音声（ウェブカメラ取得時の音声トラック）を合成に追加
      const micTrack = webcamStreamRef.current?.getAudioTracks?.()[0]
      if (micTrack) canvasStream.addTrack(micTrack)
      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        .find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
      const recorder = new MediaRecorder(canvasStream, mimeType ? { mimeType } : {})
      recorder.ondataavailable = (e) => { if (e.data.size > 0) screenChunksRef.current.push(e.data) }
      recorder.start(1000)
      screenMediaRecorderRef.current = recorder
      setIsScreenRecording(true)

      // メインページへ録画開始を通知
      channelRef.current?.postMessage({ type: 'recording_started' })

      // 画面共有が終了されたら描画ループも止める
      screenStream.getVideoTracks()[0].onended = () => {
        cancelAnimationFrame(animFrameRef.current)
        setIsScreenRecording(false)
        screenStreamRef.current = null
      }
    } catch {
      // キャンセルされた場合は何もしない
    }
  }

  /* ── 事後質問の聞き取り ───────────────────────────────────── */
  // 聞き取りはこの小窓で行う（実装は src/lib/answer-recorder.ts）。
  // メイン画面は裏側にあり、裏側のタブでは録音・マイクの扱いが制限されうるうえ、
  // 案内も入力欄も参加者から見えないため。
  function stopListening() {
    listenerRef.current?.stop()
    listenerRef.current = null
    setIsListening(false)
    setSpeechHeard(false)
    setTranscribing(false)
    setLiveText('')
  }

  function beginListening(silenceRetry: boolean) {
    stopListening()
    listenRetryRef.current = silenceRetry
    setListenNotice('')
    setListenReason('')
    const stream = webcamStreamRef.current
    if (!stream) {
      setListenNotice('マイクを使えませんでした。下の欄に入力して送信してください。')
      setListenReason('no-mic')
      return
    }
    const recorder = startAnswerRecorder({
      stream,
      onRecordingChange: setIsListening,
      onSpeechDetected: () => setSpeechHeard(true),
      onTranscribing: () => setTranscribing(true),
      onFinal: (text) => {
        listenerRef.current = null
        setTranscribing(false)
        setSpeechHeard(false)
        channelRef.current?.postMessage({ type: 'answer_text', text })
      },
      onSilence: () => {
        listenerRef.current = null
        setTranscribing(false)
        setSpeechHeard(false)
        channelRef.current?.postMessage({ type: 'answer_silence', retry: silenceRetry })
      },
      onGiveUp: (reason) => {
        listenerRef.current = null
        setTranscribing(false)
        setSpeechHeard(false)
        setListenNotice('音声をうまく取り込めませんでした。')
        setListenReason(reason)
      },
    })
    listenerRef.current = recorder
    if (!recorder) {
      setIsListening(false)
      setListenNotice('マイクを使えませんでした。下の欄に入力して送信してください。')
      setListenReason('recorder-unavailable')
    }
  }

  /** 入力欄から回答を送る（音声が使えないとき・言い直したいとき） */
  function sendTypedAnswer() {
    const text = answerInput.trim()
    if (!text) return
    stopListening()
    setListenNotice('')
    setListenReason('')
    // 入力欄はまだ空にしない。メインが受け取れたかどうか（answer_ack）を見てから
    // 消す。先に消すと、次の質問へ進んだ直後などに送った言葉が黙って消える
    channelRef.current?.postMessage({ type: 'answer_text', text })
  }

  /* ── 録画停止 → blob をメインページへ送信 ─────────────────── */
  function stopAndSendRecording(): Promise<void> {
    return new Promise((resolve) => {
      // 合成描画ループを停止
      cancelAnimationFrame(animFrameRef.current)
      // 中身が空でも必ず送る。送らないと、録画の到着を待っているメイン側が
      // 何も受け取れないまま待ち時間切れ（20秒）まで終了画面で止まる
      const send = (blob: Blob) => {
        channelRef.current?.postMessage({ type: 'screen_recording_blob', blob })
        screenStreamRef.current?.getTracks().forEach((t) => t.stop())
        resolve()
      }
      const recorder = screenMediaRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        // すでに停止済み（画面共有が先に終了した場合など）でも chunks があれば送信
        send(new Blob(screenChunksRef.current, { type: recorder?.mimeType || 'video/webm' }))
        return
      }
      recorder.onstop = () => {
        send(new Blob(screenChunksRef.current, { type: recorder.mimeType || 'video/webm' }))
      }
      recorder.stop()
    })
  }

  // 以前はタスク完了時にメイン画面へフォーカスを戻していたが、事後質問もこの小窓で
  // 行うようになったため不要になった（メイン画面は裏側のまま、聞き取りはここで行う）。

  const isLastTask = currentTaskIndex + 1 >= tasks.length
  const pendingOutcomeRef = useRef<'completed' | 'gave_up'>('completed')
  const pendingSeqRef = useRef<number | undefined>(undefined)

  /* ── タスク結果を記録して次へ（達成 / 断念）。最後なら録画を止めて質問へ ── */
  // 達成/断念のボタンを押した直後。SEQ が有効ならまず評価を聞いてから確定する。
  function handleOutcome(outcome: 'completed' | 'gave_up') {
    if (seqEnabled) { setAwaitingSeq(outcome); return }
    void commitOutcome(outcome)
  }

  async function commitOutcome(outcome: 'completed' | 'gave_up', seq?: number) {
    setAwaitingSeq(null)
    // ヒントを見た上での結果は、集計で自力の達成と分ける必要がある
    const usedHint = usedHintIdxRef.current.has(currentTaskIndex)
    // 前提タスクを断念した場合は、結果を送っても次へは進めない。
    // 次のタスクはこのタスクができている状態から始まるので、先に立て直しを案内する
    if (outcome === 'gave_up' && needsRecovery(tasks, currentTaskIndex)) {
      channelRef.current?.postMessage({ type: 'task_outcome', outcome, seq, usedHint })
      setRecoveryAtIdx(currentTaskIndex)
      return
    }
    if (!isLastTask) {
      // 途中のタスク: 結果だけ送って次へ（録画は継続）
      channelRef.current?.postMessage({ type: 'task_outcome', outcome, seq, usedHint })
      setCurrentTaskIndex((i) => Math.min(i + 1, tasks.length - 1))
      return
    }
    // 最後のタスク: 録画必須（未開始なら警告）
    if (!isScreenRecording && screenChunksRef.current.length === 0) {
      pendingOutcomeRef.current = outcome
      pendingSeqRef.current = seq
      setWarnNoRecord(true)
      return
    }
    finalize(outcome, seq)
  }

  /**
   * 最後のタスクの結果を確定する。
   *
   * ここでは録画を止めない。止めて小窓を閉じてしまうと、このあとの事後質問が
   * 映像も音声もまったく記録されなくなる（実際にそうなっていた）。録画を止めるのは
   * 面談そのものが終わったとき（メインから session_ended が届いたとき）だけ。
   * 事後質問へ切り替えるのもメイン側の合図（post_interview_start）に従う。
   */
  function finalize(outcome: 'completed' | 'gave_up', seq?: number) {
    setWarnNoRecord(false)
    const usedHint = usedHintIdxRef.current.has(currentTaskIndex)
    channelRef.current?.postMessage({ type: 'task_outcome', outcome, seq, usedHint })
  }

  /* ── 前提タスクの立て直し ──────────────────────────────── */
  // 開始地点まで到達できた → 次のタスクへ。
  // 「前提を代行して開始した」印はメイン側（記録を持っている方）で付ける。
  function recoveredPrereq() {
    channelRef.current?.postMessage({ type: 'prereq_recovered' })
    setRecoveryAtIdx(null)
    setCurrentTaskIndex((i) => Math.min(i + 1, tasks.length - 1))
  }

  // 到達できなかった → 後続は未実施として記録される。
  // この先に実施できるタスクが無い場合、メインはタスク完了とみなして事後質問へ進む。
  // 録画はそのまま続ける（止めるのは面談が終わったときだけ）。
  async function cannotRecoverPrereq() {
    const { resume } = blockedAfter(tasks, currentTaskIndex)
    if (resume >= tasks.length) {
      // この先に実施できるタスクは無い。メインがタスク完了とみなして事後質問へ
      // 進めるので、ここでは結果だけ送る（録画は面談が終わるまで止めない）
      channelRef.current?.postMessage({ type: 'prereq_failed' })
      setRecoveryAtIdx(null)
      return
    }
    setRecoveryAtIdx(null)
    channelRef.current?.postMessage({ type: 'prereq_failed' })
    setCurrentTaskIndex(resume)
  }

  /* ── セッション終了 ───────────────────────────────────────── */
  async function endSession() {
    // SEQ 入力待ちのまま終了された場合、押した達成/断念を取りこぼさない（評価なしで確定）
    if (awaitingSeq) {
      channelRef.current?.postMessage({
        type: 'task_outcome',
        outcome: awaitingSeq,
        usedHint: usedHintIdxRef.current.has(currentTaskIndex),
      })
      setAwaitingSeq(null)
    }
    // 録画の停止と書き出しはメインからの session_ended で行う。ここで止めると、
    // 終了処理の途中で録画が二重に書き出され、メイン側の待ち合わせと噛み合わない
    stopListening()
    channelRef.current?.postMessage({ type: 'end_session' })
    setDoneMessage('セッションを終了しています...')
    setWidgetPhase('done')
  }

  // 事前手続き（録画開始 →（サービスURLがあれば）サービスを開く）が完了したか。
  // 完了して初めてタスク文言と結果ボタンを表示し、準備中は隠して混乱を防ぐ。
  const readyForTask = isScreenRecording && (serviceOpened || !stimulusUrl)

  // タスク1の直前だけ、思考発話の案内→「スタート」を挟む（2問目以降は不要）。
  // 案内を読み終える前にタスク1の文言が見えてしまう不具合の修正のため、
  // ready になっても即座にはタスクを見せず、まず案内を出す。
  const showGuidance = readyForTask && currentTaskIndex === 0 && !guidanceDismissed
  const taskVisible = readyForTask && !showGuidance

  // 事前手続きが揃った瞬間にメインへ通知する。
  // タスク1のみ、まず案内を読ませてから（guidance_ready）、「スタート」を押して
  // 初めて task_ready を送る＝所要時間の計測はそこが起点になる。
  // 2問目以降（小窓の開き直し等）は案内不要なのでそのまま task_ready を送る。
  // ※フック規則のため、必ず早期 return より前で呼ぶこと。
  const taskReadySentRef = useRef(false)
  const guidanceRequestedRef = useRef(false)
  useEffect(() => {
    if (!readyForTask || taskReadySentRef.current) return
    if (showGuidance) {
      if (guidanceRequestedRef.current) return
      guidanceRequestedRef.current = true
      channelRef.current?.postMessage({ type: 'guidance_ready' })
      return
    }
    taskReadySentRef.current = true
    channelRef.current?.postMessage({ type: 'task_ready' })
  }, [readyForTask, showGuidance])

  // 詰まった参加者への声かけ。着手（タスクが実際に見えてから＝taskVisible）してから
  // hintDelaySec 後に出す。案内の表示中・読み上げ中（タスク文の朗読含む）はカウントしない
  // （説明を聞いている時間を「詰まっている」時間に含めないため。ttsSpeaking が false に
  // 戻った時点でこの effect が再実行され、そこから計測が始まる）。
  // タスクが変わるとタイマーを張り直すので、前のタスクの経過は持ち越さない。
  // ※フック規則のため、必ず早期 return より前に置くこと。
  useEffect(() => {
    if (!hintDelaySec || !taskVisible || ttsSpeaking) return
    const idx = currentTaskIndex
    const timer = setTimeout(() => setStuckAtIdx(idx), hintDelaySec * 1000)
    return () => clearTimeout(timer)
  }, [hintDelaySec, taskVisible, currentTaskIndex, ttsSpeaking])

  const stuckOnTask = stuckAtIdx === currentTaskIndex
  const hintShown = hintShownAtIdx === currentTaskIndex
  // 前提タスクの立て直し待ち。この間は達成/できなかったの操作を出さない
  const recoveryPending = recoveryAtIdx === currentTaskIndex && needsRecovery(tasks, currentTaskIndex)

  // 思考発話の促し。黙って操作している間だけ出す。
  // 他の案内（詰まったときの声かけ・立て直し手順・SEQ）が出ているときは促さない
  // ＝画面に2枚重ねない。読んでほしいものが増えるほど、どれも読まれなくなる。
  // ※フック規則のため、早期 return より前に置くこと。
  useSilenceNudge({
    stream: micStream,
    // 読み上げ中は促さない（メインから tts_state で届く）。マイクの echoCancellation で
    // 読み上げ音声はマイク信号から除去されるため、入れないと読み上げ中も沈黙として数え、
    // 促しが読み上げを途中で打ち切ってしまう。false に戻った時点で計測を張り直す
    // ＝「読み上げが終わってから」20秒を数え始める。
    active: widgetPhase === 'task' && taskVisible && !ttsSpeaking
      && !stuckOnTask && !recoveryPending && !awaitingSeq,
    resetKey: currentTaskIndex,
    onNudge: () => {
      setThinkAloudNudge(true)
      // 声はメイン画面側で鳴らす（TTS の持ち主がそちら）
      channelRef.current?.postMessage({ type: 'speak_nudge' })
      // 合図なので自動で引っ込める。押して消させると操作を1つ増やすことになる
      setTimeout(() => setThinkAloudNudge(false), 9000)
    },
  })

  // ヒントを開いたら、その場でメイン側へ伝える。
  // 小窓の ref だけに持つと、小窓を閉じて開き直したときに記録が消え、
  // 条件付き成功が自力成功として集計されてしまう（数字が良い方向に狂う）。
  function revealHint() {
    setHintShownAtIdx(currentTaskIndex)
    usedHintIdxRef.current.add(currentTaskIndex)
    channelRef.current?.postMessage({ type: 'hint_used', index: currentTaskIndex })
  }

  /* ── 完了画面 ─────────────────────────────────────────────── */
  if (widgetPhase === 'done') {
    return (
      <div className="min-h-screen bg-white text-gray-900 flex items-center justify-center">
        <div className="text-center px-6">
          <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" strokeWidth={1.75} />
          </div>
          <p className="text-sm text-gray-600">{doneMessage}</p>
        </div>
      </div>
    )
  }

  /* ── 事後質問画面 ─────────────────────────────────────────── */
  // タスクが全部終わったあと、質問もこの小窓の中で行う。
  // 読み上げ中はメイン画面から届く revealedText（タイプライター表示）を出し、
  // 読み終えたら質問文の全文に切り替える。
  if (widgetPhase === 'interview') {
    const shownQuestion = ttsSpeaking ? revealedText : question
    return (
      <div className="bg-white text-gray-900">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
          <span className="text-xs font-semibold text-gray-900 tracking-tight">UserVoice</span>
          <span className="text-gray-500 text-xs">最後にいくつか質問します</span>
        </div>

        {/* カメラ（タスク中と同じ位置に置き、見え方を変えない） */}
        <div className="relative bg-gray-900 aspect-video">
          <video
            ref={webcamVideoRef}
            autoPlay
            muted
            playsInline
            aria-label="あなたのカメラ映像"
            className={`w-full h-full object-cover scale-x-[-1] ${cameraError ? 'hidden' : ''}`}
          />
          {isListening && (
            <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-gray-950/70 text-white px-2 py-1 rounded-md">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              <span className="text-[10px]">{speechHeard ? 'お話しどうぞ' : 'どうぞお話しください'}</span>
            </div>
          )}
          {ttsSpeaking && (
            <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-gray-950/70 text-white px-2 py-1 rounded-md">
              <Volume2 className="w-3 h-3" strokeWidth={2} />
              <span className="text-[10px]">AI が話しています</span>
            </div>
          )}
        </div>

        <div className="px-3 py-3 space-y-2.5">
          {/* 質問文 */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5 max-h-40 overflow-y-auto">
            <p className="text-xs text-gray-900 leading-relaxed whitespace-pre-line">
              {shownQuestion || '質問を準備しています…'}
            </p>
          </div>

          {aiThinking && (
            <p className="text-[11px] text-gray-500">回答を聞いています…</p>
          )}

          {/* 評価質問はボタンで回答する */}
          {!aiThinking && !ttsSpeaking && questionType === 'rating' && (
            <div className="border border-gray-200 rounded-lg p-2.5">
              <RatingQuestion
                compact
                question=""
                onSubmit={(v) => channelRef.current?.postMessage({ type: 'rating_answer', value: v, label: `${v} / 5` })}
              />
            </div>
          )}
          {!aiThinking && !ttsSpeaking && questionType === 'nps' && (
            <div className="border border-gray-200 rounded-lg p-2.5">
              <NpsQuestion
                compact
                question=""
                onSubmit={(v) => channelRef.current?.postMessage({ type: 'rating_answer', value: v, label: `${v} / 10` })}
              />
            </div>
          )}

          {/* 自由回答: 聞き取り中の文字と、テキストでの入力欄 */}
          {questionType === 'open' && (
            <>
              {transcribing && (
                <p className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-2 py-1.5">
                  聞き取っています…
                </p>
              )}
              {/* 録音方式では「話し終えた」をブラウザが教えてくれない。静かになれば
                  自動で締めるが、参加者が自分で終えられる手段も必ず出しておく */}
              {isListening && !transcribing && (
                <button
                  onClick={() => listenerRef.current?.finishNow()}
                  className="w-full inline-flex items-center justify-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg py-2 text-xs font-medium transition-colors"
                >
                  <Check className="w-3.5 h-3.5" strokeWidth={2} />
                  話し終えました
                </button>
              )}
              {liveText && (
                <p className="text-xs text-gray-700 leading-relaxed bg-blue-50 border border-blue-100 rounded-lg p-2.5">
                  {liveText}
                </p>
              )}
              {listenNotice && (
                <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 leading-snug space-y-1.5">
                  <p>{listenNotice}下の欄に入力して送信することもできます。</p>
                  {listenReason && (
                    <p className="text-[10px] text-amber-700/80">（参考情報: {listenReason}）</p>
                  )}
                  {/* クリックで start し直すと、ブラウザが要求する「利用者の操作」の
                      文脈に戻るため、自動再開では通らなかった場合でも通ることがある */}
                  <button
                    onClick={() => beginListening(listenRetryRef.current)}
                    className="w-full inline-flex items-center justify-center gap-1.5 bg-white border border-amber-300 hover:border-amber-500 text-amber-900 rounded-md py-1.5 text-[11px] font-medium transition-colors"
                  >
                    <Mic className="w-3 h-3" strokeWidth={2} />
                    もう一度録音する
                  </button>
                </div>
              )}
              <div className="flex gap-1.5">
                <input
                  value={answerInput}
                  onChange={(e) => setAnswerInput(e.target.value)}
                  onKeyDown={(e) => {
                    // 日本語入力の変換確定 Enter で送信しない
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      sendTypedAnswer()
                    }
                  }}
                  placeholder="うまく聞き取れないときは入力できます"
                  className="flex-1 min-w-0 border border-gray-300 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-gray-500"
                />
                <button
                  onClick={sendTypedAnswer}
                  disabled={!answerInput.trim()}
                  className="flex-shrink-0 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 text-white rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
                >
                  送信
                </button>
              </div>
            </>
          )}

          {/* タスク画面と同じく、常に押せる脱出口を最下部に置く。事後質問は評価ボタン
              だけの回で聞き取りも沈黙タイマーも動かないことがあり、ここに終了手段が
              無いと参加者が詰む */}
          <button
            onClick={endSession}
            className="w-full inline-flex items-center justify-center gap-1.5 border border-gray-300 hover:border-gray-400 text-gray-600 hover:text-gray-900 py-2 rounded-lg text-xs transition-colors"
          >
            <X className="w-3.5 h-3.5" strokeWidth={2} />
            セッションを終了
          </button>
        </div>
      </div>
    )
  }

  const currentTask = tasks[currentTaskIndex]

  /* ── タスク画面 ─────────────────────────────────────────────── */
  // 注: Document PiP の iframe 内では 100vh 等の viewport 単位が実際の窓より大きく評価され、
  //     min-h-screen だと巨大な余白＋スクロールが出る。ここでは vh/flex 高さ配分を使わず、
  //     ヘッダー→カメラ→タスク→ボタンを自然な縦積み（block flow）で並べて崩れを防ぐ。
  return (
    <div className="bg-white text-gray-900">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-900 tracking-tight">UserVoice</span>
        {tasks.length > 0 && (
          <span className="text-gray-500 text-xs">タスク {currentTaskIndex + 1} / {tasks.length}</span>
        )}
      </div>

      {/* ウェブカメラ（16:9 で潰れず表示。取得失敗時はフォールバック） */}
      <div className="relative bg-gray-900 aspect-video">
        <video
          ref={webcamVideoRef}
          autoPlay
          muted
          playsInline
          aria-label="あなたのカメラ映像"
          className={`w-full h-full object-cover scale-x-[-1] ${cameraError ? 'hidden' : ''}`}
        />
        {cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            <AlertTriangle className="w-5 h-5 text-gray-300" strokeWidth={1.75} />
            <p className="text-[11px] text-gray-200 leading-relaxed">カメラを利用できません。<br />ブラウザで許可されているかご確認ください。</p>
            <button
              onClick={initWebcam}
              className="mt-0.5 text-[11px] bg-white/90 hover:bg-white text-gray-900 px-2.5 py-1 rounded-md font-medium transition-colors"
            >
              再試行
            </button>
          </div>
        )}
        {isScreenRecording && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-white/95 border border-red-200 px-2 py-1 rounded-md shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] text-red-600 font-semibold tracking-wide">REC</span>
          </div>
        )}
        {/* 顔フレーミング警告（カメラ下端にオーバーレイ）。見切れ・未検出のときだけ出す */}
        {!cameraError && (faceStatus === 'no_face' || faceStatus === 'cut_off') && (
          <div className="absolute bottom-0 inset-x-0 flex items-center gap-1.5 bg-amber-500/95 text-white px-2.5 py-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2.25} />
            <span className="text-[11px] font-medium leading-snug">
              {faceStatus === 'no_face'
                ? '顔が写っていません。カメラに顔が入るように調整してください'
                : '顔が見切れています。中央に顔が来るように位置を調整してください'}
            </span>
          </div>
        )}
      </div>

      {/* タスク内容（上詰め。長文はここだけスクロールし、下のボタンは常に見える。vh非依存で px 上限）。
          事前手続き（録画・サービス起動）が終わるまでは、タスク文言ではなく準備の案内を出す。
          タスク1の直前は、案内の読み上げ→「スタート」を挟む（showGuidance）。 */}
      <div className="px-3 py-3 max-h-80 overflow-y-auto">
        {showGuidance ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2.5">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium">はじめに</p>
            <p className="text-sm text-gray-900 leading-relaxed">
              {(ttsSpeaking ? revealedText : guidanceText) || '案内を読み上げています…'}
            </p>
            <button
              type="button"
              onClick={() => setGuidanceDismissed(true)}
              disabled={ttsSpeaking}
              className="w-full inline-flex items-center justify-center gap-1.5 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-wait text-white py-2.5 rounded-lg text-sm font-semibold transition-colors"
            >
              {ttsSpeaking ? '読み上げています…' : 'スタート'}
            </button>
          </div>
        ) : taskVisible ? (
          currentTask ? (
            <div className="space-y-2">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium">現在のタスク</p>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* サービスを閉じてしまった場合の再オープン導線。常時の状態表示は
                        タスク文の領域を広く取るため撤去し、ここに小さくまとめた */}
                    {stimulusUrl && (
                      <a
                        href={stimulusUrl}
                        target="uservoice-service"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-900 transition-colors"
                      >
                        <Globe className="w-3 h-3" strokeWidth={2} />
                        開き直す
                      </a>
                    )}
                    {/* 読み上げの聞き直し。音声はメイン画面側で鳴らす（TTS の持ち主がそちらなので、
                        小窓を開き直しても再生が二重にならない）。自動再生が止められた場合の再試行にもなる */}
                    <button
                      type="button"
                      onClick={() => channelRef.current?.postMessage({ type: 'speak_task' })}
                      className="inline-flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-900 transition-colors"
                    >
                      <Volume2 className="w-3 h-3" strokeWidth={2} />
                      もう一度聞く
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-900 leading-relaxed">
                  {ttsSpeaking ? revealedText : currentTask.text}
                </p>
              </div>
              {/* 思考発話の促し（沈黙が続いたときだけ・自動で消える） */}
              {thinkAloudNudge && <ThinkAloudNudge compact />}
              {/* 前提タスクの立て直し案内。手順が長くても操作ボタンが窓の外へ
                  押し出されないよう、ボタンは下の sticky 領域に置く */}
              {recoveryPending && (
                <TaskRecovery
                  compact
                  hint={currentTask.hint ?? null}
                  nextTaskText={tasks[currentTaskIndex + 1]?.text ?? null}
                />
              )}
              {/* SEQ 入力待ち中は出さない。達成を押した後にヒントを開くと、
                  自力の成功が「ヒントあり」として記録されてしまうため。 */}
              {stuckOnTask && !awaitingSeq && !recoveryPending && (
                <StuckHelp
                  compact
                  hint={currentTask.hint ?? null}
                  hintShown={hintShown}
                  onRevealHint={revealHint}
                />
              )}
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-sm text-gray-500">タスクを実行してください</p>
            </div>
          )
        ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-wide font-medium">準備</p>
            <p className="text-sm text-gray-600 leading-relaxed">
              下のボタンで準備を進めてください{stimulusUrl ? '（画面録画 → サービスを開く）' : '（画面録画）'}。準備ができると、ここにタスクが表示されます。
            </p>
          </div>
        )}
      </div>

      {/* ボタン群。操作はこの小窓に集約し、黒い主 CTA が常に 1 つだけになるよう段階表示する。
          録画 →（録画後に）サービスを開く →（開いた後に）達成/できなかった/終了、と主役が入れ替わる。

          sticky で最下部に貼り付ける。小窓は 400×560 と狭く、上に何か（声かけバナー・
          長いタスク文言・ヒント本文）が増えると、この操作群が窓の外へ押し出されてしまう。
          特に「うまくいかないときは『できなかった』で次へ」と案内しながら、その
          「できなかった」自体が見えなくなるのは、救済のつもりが詰みを作ることになる。 */}
      <div className="px-3 pb-3 pt-2 space-y-2 sticky bottom-0 bg-white border-t border-gray-100">
        {/* 録画開始ボタン。開始後は何も表示しない（タスク文の領域を広く取るため。
            録画中であること自体はブラウザ側の共有インジケータで分かる） */}
        {!isScreenRecording && (
          <div className="space-y-1">
            <button
              onClick={startScreenRecording}
              className="w-full inline-flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 border-2 border-red-500 hover:border-red-600 text-red-700 py-2.5 rounded-lg text-sm font-semibold transition-colors animate-pulse hover:animate-none"
            >
              <Monitor className="w-4 h-4" strokeWidth={2} />
              画面録画を開始する
              <span className="bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded leading-none">必須</span>
            </button>
            <p className="text-[10px] text-gray-500 text-center leading-snug">
              表示されるダイアログで<span className="font-semibold text-gray-700">「画面全体」</span>を選んで共有してください
            </p>
          </div>
        )}

        {/* サービスを開く: 録画開始後・未オープン時のみ主 CTA として表示。押したら状態を進める */}
        {isScreenRecording && stimulusUrl && !serviceOpened && (
          <div className="space-y-1">
            <a
              href={stimulusUrl}
              target="uservoice-service"
              rel="noopener noreferrer"
              onClick={() => { setServiceOpened(true); channelRef.current?.postMessage({ type: 'service_opened' }) }}
              className="w-full inline-flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 text-white py-2.5 rounded-lg text-sm font-semibold transition-colors"
            >
              <Globe className="w-4 h-4" strokeWidth={2} />
              サービスを開く（新しいタブ）
            </a>
            <p className="text-[10px] text-gray-500 text-center leading-snug">
              新しいタブでサービスが開きます。操作を試してください
            </p>
          </div>
        )}

        {/* 結果ボタン: サービスを開いた後（サービス URL 未設定なら録画開始後）に初めて表示。
            タスク1の直前は案内の「スタート」を押すまでは出さない（taskVisible）。
            「サービスを開いています／開き直す」の状態表示は、タスク文の領域を広く
            取るためタスクヘッダー側（もう一度聞くの隣）に移した */}
        {taskVisible && (
          <>
            {/* 録画未開始の警告（録画が途中で止まった等の保険） */}
            {warnNoRecord && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-xs text-amber-900 space-y-2">
                <p className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2} />
                  画面録画が開始されていません
                </p>
                <p className="text-amber-800/80">録画なしでタスクを完了しますか？</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setWarnNoRecord(false)}
                    className="flex-1 bg-amber-600 hover:bg-amber-700 text-white py-1.5 rounded-md text-xs font-medium transition-colors"
                  >
                    録画してから完了
                  </button>
                  <button
                    onClick={() => finalize(pendingOutcomeRef.current, pendingSeqRef.current)}
                    className="flex-1 bg-white border border-amber-300 hover:border-amber-500 text-amber-800 py-1.5 rounded-md text-xs transition-colors"
                  >
                    このまま完了
                  </button>
                </div>
              </div>
            )}

            <p className="text-[10px] text-gray-500 text-center leading-snug pt-1">
              {recoveryPending ? '上の手順で準備できたら押してください' : '操作が終わったら押してください'}
            </p>
            {recoveryPending ? (
              <TaskRecoveryActions compact onReady={recoveredPrereq} onCannot={() => void cannotRecoverPrereq()} />
            ) : awaitingSeq ? (
              /* SEQ 入力中: 評価を選ぶまで次に進まない（1タップで確定） */
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <SeqScale compact onSelect={(v) => void commitOutcome(awaitingSeq, v)} />
                <button
                  onClick={() => setAwaitingSeq(null)}
                  className="mt-2 w-full text-[11px] text-gray-500 hover:text-gray-900 py-1"
                >
                  戻る
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => handleOutcome('completed')}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 bg-gray-900 hover:bg-gray-800 active:bg-black text-white py-2.5 rounded-lg text-sm font-semibold transition-colors"
                >
                  <Check className="w-4 h-4" strokeWidth={2.5} />
                  達成して{isLastTask ? '質問へ' : '次へ'}
                </button>
                <button
                  onClick={() => handleOutcome('gave_up')}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 bg-white border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  できなかった
                </button>
              </div>
            )}
          </>
        )}

        {/* セッション終了は常に押せる脱出口として最下部に常時表示（録画を始めない参加者が
            中断できず詰むのを防ぐ）。控えめな枠線ボタンなので黒い主 CTA とは競合しない。 */}
        <button
          onClick={endSession}
          className="w-full inline-flex items-center justify-center gap-1.5 border border-gray-300 hover:border-gray-400 text-gray-600 hover:text-gray-900 py-2 rounded-lg text-xs transition-colors"
        >
          <X className="w-3.5 h-3.5" strokeWidth={2} />
          セッションを終了
        </button>
      </div>
    </div>
  )
}

export default function WidgetPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-gray-500 text-sm">読み込み中...</div>
      </div>
    }>
      <WidgetContent />
    </Suspense>
  )
}
