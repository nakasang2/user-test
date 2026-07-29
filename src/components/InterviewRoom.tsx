'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { upload } from '@vercel/blob/client'
import { track } from '@/lib/analytics'
// 参加者に感情を見せなくなったため、グラフ描画（recharts）は読み込まない。
// 被験者側の画面が軽くなり、テストの妨げになる要素も減る。
import { useEmotionDetection } from '@/hooks/useEmotionDetection'
import {
  Mic,
  Monitor,
  Image as ImageIcon,
  Palette,
  Globe,
  AppWindow,
  Check,
  CheckCircle2,
  Video,
  ArrowRight,
  Send,
  Sparkles,
  AlertCircle,
  AlertTriangle,
  Copy,
} from 'lucide-react'
import SeqScale from '@/components/SeqScale'
import StuckHelp from '@/components/StuckHelp'
import { elapsedSec, nowMs, cacheBustToken } from '@/lib/elapsed'

interface Question {
  id?: string
  text: string
  type: 'open' | 'rating' | 'nps'
}

interface Props {
  sessionId: string
  participantToken?: string
  roomName: string
  questions: Question[]
  interviewTitle: string
  participantName?: string
  interviewType?: 'interview' | 'impression' | 'usability'
  usabilityMode?: 'prototype' | 'service'
  stimulusUrl?: string
  stimulusDuration?: number  // seconds (default 5)
  tasks?: { id?: string; text: string; order: number; hint?: string | null }[]
  seqEnabled?: boolean
  /** タスク着手から何秒で「詰まっていませんか」の声かけを出すか。未設定なら出さない */
  hintDelaySec?: number
}

// 測定結果（構造化して /results に保存する定量データ）
interface TaskResultEntry {
  taskId?: string | null
  order: number
  text: string
  outcome: 'completed' | 'gave_up'
  startedAt: number
  endedAt: number
  seq?: number
  /** ヒントを見た上での結果か。自力の達成と混ぜると成功率が実態より良く見える */
  usedHint?: boolean
}

interface AnswerEntry {
  questionId?: string | null
  order: number
  text: string
  type: 'open' | 'rating' | 'nps'
  valueNum?: number | null
  valueText?: string | null
  followUpCount?: number
  answeredAt: number
}

interface TranscriptEntry {
  speaker: string
  text: string
  start: number
  end?: number
}

type Phase = 'guide' | 'waiting' | 'stimulus' | 'task' | 'intro' | 'interview' | 'thinking' | 'ending' | 'done'

export default function InterviewRoom({
  sessionId,
  participantToken,
  questions,
  interviewTitle,
  participantName,
  interviewType,
  usabilityMode,
  stimulusUrl,
  stimulusDuration,
  tasks,
  seqEnabled,
  hintDelaySec,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const speechRef = useRef<any>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startTimeRef = useRef<number>(nowMs())
  const transcriptRef = useRef<TranscriptEntry[]>([])
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  // OpenAI TTS 用: 再生中の Audio と世代カウンタ（多重再生・キャンセル管理）
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const speakVersionRef = useRef(0)

  const currentQuestionIndexRef = useRef(0)
  const followUpCountRef = useRef(0)
  const conversationBufferRef = useRef('')

  // 実感情検出フック
  const { status: emotionStatus, lastEmotion, faceStatus, startDetection, stopDetection, getSnapshots } = useEmotionDetection(5000)
  const [cameraReady, setCameraReady] = useState(false)
  // 途中離脱でも残るよう、感情スナップショットを検出のたびに逐次サーバー保存する（失敗は無視）。
  // 最終的には submitResults→/process が全件で上書きする。全件は useEmotionDetection 側の
  // getSnapshots() が保持しているので、ここで履歴を持つ必要はない
  //（参加者には感情を見せないため、表示用の履歴も不要）。
  useEffect(() => {
    if (!lastEmotion || !participantToken) return
    fetch('/api/emotions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-participant-token': participantToken },
      body: JSON.stringify({ sessionId, ...lastEmotion }),
    }).catch(() => {})
  }, [lastEmotion, sessionId, participantToken])

  const [phase, setPhase] = useState<Phase>('guide') // Feature 6: 初期フェーズを guide に
  const [displayedQuestion, setDisplayedQuestion] = useState('')
  const [isFollowUp, setIsFollowUp] = useState(false)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [liveText, setLiveText] = useState('')
  const [cameraError, setCameraError] = useState(false)
  // 一時的な通知（TTS 失敗・通信エラーなど。被験者に状況を伝える）
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [aiThinking, setAiThinking] = useState(false)
  const [textInput, setTextInput] = useState('')
  // null = チェック前（初回レンダリング）、true/false = チェック済み
  const [speechSupported, setSpeechSupported] = useState<boolean | null>(null)
  const [textOnlyMode, setTextOnlyMode] = useState(false) // 非対応でも続行する場合
  const [isListening, setIsListening] = useState(false)
  const [recordingDownloadUrl, setRecordingDownloadUrl] = useState<string | null>(null)
  // 回答送信の状態（完了画面の表示・beforeunload ガード・再送に使う）
  const [submitState, setSubmitState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  // テキスト入力フォールバック用：listenForAnswer のコールバックを保持
  const onAnswerCallbackRef = useRef<((answer: string) => void) | null>(null)

  // usability / prototype 用：画面共有
  const screenVideoRef = useRef<HTMLVideoElement>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const [screenSharing, setScreenSharing] = useState(false)
  const [serviceOpened, setServiceOpened] = useState(false)   // service モード: 小窓でサービスを開いたか（メイン画面プログレス表示用）
  const [screenShareError, setScreenShareError] = useState<string | null>(null)
  const [currentTaskIndex, setCurrentTaskIndex] = useState(0)
  // BroadcastChannel の onmessage は startInterview 時のクロージャを保持するため、
  // 最新のタスク番号は ref で参照する（state だけだと陳腐化して複数タスクで進めない）
  const currentTaskIndexRef = useRef(0)
  // 小窓（service モード）との通信チャンネル。gotoTask から現在タスクを送るため、
  // それより前に宣言しておく。
  const widgetChannelRef = useRef<BroadcastChannel | null>(null)

  // ── 詰まった参加者への声かけ ──
  // 一定時間そのタスクに留まっていたら「次に進めます」と案内し、ヒントがあれば見せる。
  // タスクを移るたびにリセットする（前のタスクの経過を持ち越さない）。
  const [stuckOnTask, setStuckOnTask] = useState(false)
  // ヒントを見たタスク番号（1始まり）。達成/断念の記録時に添える
  const usedHintOrdersRef = useRef<Set<number>>(new Set())
  const [hintShown, setHintShown] = useState(false)
  function resetStuckTimer() {
    setStuckOnTask(false)
    setHintShown(false)
  }
  function revealHint() {
    setHintShown(true)
    usedHintOrdersRef.current.add(currentTaskIndexRef.current + 1)
  }

  function gotoTask(idx: number) {
    currentTaskIndexRef.current = idx
    setCurrentTaskIndex(idx)
    // 次タスクの計測開始（前タスクの終了時刻＝次タスクの開始時刻）
    taskStartedAtRef.current = elapsedSec(startTimeRef.current)
    firstTaskStartedRef.current = true
    resetStuckTimer()
    setTaskStartTick((n) => n + 1)
    // 小窓にも同じタスク番号を送る。ここで送らないと、メイン画面のタスク一覧から
    // 別のタスクへ飛んだときに小窓だけ古い番号のままになり、参加者が小窓で見て
    // 操作した内容が、メイン側では別タスクの結果・所要時間・ヒント有無として記録される。
    widgetChannelRef.current?.postMessage({ type: 'task_update', currentTaskIndex: idx })
  }
  // 測定結果（定量データ）。文字起こしとは別に /results へ構造化保存する
  const taskResultsRef = useRef<TaskResultEntry[]>([])
  const answersRef = useRef<AnswerEntry[]>([])
  const taskStartedAtRef = useRef<number>(0)
  // 最初のタスクの計測開始。事前手続き（録画開始・サイトを開く）の時間を
  // タスク1に含めないよう、被験者が実際に着手できる時点まで遅らせる。
  const firstTaskStartedRef = useRef(false)
  // メイン画面での SEQ 入力待ち（達成/断念を押した直後に評価を聞く）
  const [awaitingSeq, setAwaitingSeq] = useState<'completed' | 'gave_up' | null>(null)
  // SEQ が有効なら先に評価を聞き、選択後に結果を確定する
  function handleTaskOutcome(outcome: 'completed' | 'gave_up') {
    if (seqEnabled) { setAwaitingSeq(outcome); return }
    recordTaskOutcome(outcome)
  }
  function commitSeq(value: number) {
    const outcome = awaitingSeq
    setAwaitingSeq(null)
    if (outcome) recordTaskOutcome(outcome, value)
  }
  function markFirstTaskStart() {
    if (firstTaskStartedRef.current) return
    firstTaskStartedRef.current = true
    taskStartedAtRef.current = elapsedSec(startTimeRef.current)
    setTaskStartTick((n) => n + 1)  // 声かけタイマーの起点
  }
  // 「タスクに着手した瞬間」を effect に伝えるためのカウンタ。
  // ref の更新では再レンダーが起きずタイマーを張り直せないため、state で持つ。
  const [taskStartTick, setTaskStartTick] = useState(0)

  // 声かけタイマー。着手（taskStartTick）から hintDelaySec 後に一度だけ立てる。
  // hintDelaySec 未設定なら何もしない（既存調査の進行を変えない）。
  useEffect(() => {
    if (!hintDelaySec || hintDelaySec <= 0) return
    if (taskStartTick === 0) return   // まだ着手していない
    if (phase !== 'task') return      // タスク中以外では出さない
    const timer = setTimeout(() => setStuckOnTask(true), hintDelaySec * 1000)
    return () => clearTimeout(timer)
  }, [hintDelaySec, taskStartTick, phase])
  const [stimulusCountdown, setStimulusCountdown] = useState(0)
  const [stimulusError, setStimulusError] = useState(false)
  const stimulusStartedRef = useRef(false)   // カウント開始の二重起動防止
  const stimulusProceededRef = useRef(false)  // 質問遷移の二重実行防止
  const stimulusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stimulusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const screenMediaRecorderRef = useRef<MediaRecorder | null>(null)
  const screenRecordedChunksRef = useRef<Blob[]>([])
  const screenDrawRafRef = useRef<number>(0)        // 合成描画ループの RAF
  const screenBlobRef = useRef<Blob | null>(null)   // サービスモードで小窓から届く合成 Blob を保持
  const [screenRecordingDownloadUrl, setScreenRecordingDownloadUrl] = useState<string | null>(null)

  // フローティングウィジェット (service モード)
  const [widgetBlocked, setWidgetBlocked] = useState(false)
  const pipWindowRef = useRef<Window | null>(null)   // Document PiP または popup の window 参照
  const startedRef = useRef(false)  // startInterview の二重起動防止
  const endedRef = useRef(false)    // endInterview の二重実行防止（結果の二重送信を防ぐ）

  // 音声認識サポート確認（マウント時）
  //
  // window の API 有無はサーバー側では判定できない。初期値で判定しようとすると
  // サーバーとクライアントで結果が変わりハイドレーションのズレになるため、
  // マウント後に確定させる必要がある。規則を個別に外す。
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition // eslint-disable-line @typescript-eslint/no-explicit-any
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSpeechSupported(!!SR)
    }
  }, [])

  // ── 一時通知トースト ──────────────────────────────────
  const showNotice = useCallback((msg: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    setNotice(msg)
    noticeTimerRef.current = setTimeout(() => setNotice(null), 6000)
  }, [])

  // ── カメラ初期化（マウント時・再試行時に呼ぶ）────────
  const initCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      streamRef.current = stream
      setCameraError(false)
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        // ビデオが再生可能になったら感情検出を開始できる状態にする
        videoRef.current.addEventListener('loadeddata', () => setCameraReady(true), { once: true })
      }
    } catch {
      setCameraError(true)
    }
  }, [])

  // ── TTS（OpenAI tts-1）────────────────────────────────
  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (typeof window === 'undefined') return

    // 再生中の音声をキャンセル
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      currentAudioRef.current = null
    }
    const version = ++speakVersionRef.current

    setIsSpeaking(true)

    // 文字起こしログへ即時追加（音声再生前に表示）
    const entry: TranscriptEntry = {
      speaker: 'Interviewer',
      text,
      start: elapsedSec(startTimeRef.current),
    }
    transcriptRef.current = [...transcriptRef.current, entry]
    setTranscript([...transcriptRef.current])

    fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`TTS error: ${res.status}`)
        return res.blob()
      })
      .then((blob) => {
        if (version !== speakVersionRef.current) return // 後続の speak に上書きされた
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        currentAudioRef.current = audio
        audio.onended = () => {
          URL.revokeObjectURL(url)
          currentAudioRef.current = null
          if (version !== speakVersionRef.current) return
          setIsSpeaking(false)
          onEnd?.()
        }
        audio.onerror = () => {
          URL.revokeObjectURL(url)
          currentAudioRef.current = null
          if (version !== speakVersionRef.current) return
          setIsSpeaking(false)
          onEnd?.()
        }
        audio.play().catch(() => {
          setIsSpeaking(false)
          showNotice('音声の再生に失敗しました。画面の質問テキストをご覧ください。')
          if (version === speakVersionRef.current) onEnd?.()
        })
      })
      .catch(() => {
        if (version !== speakVersionRef.current) return
        setIsSpeaking(false)
        track('interview_tts_failed', { sessionId })
        showNotice('音声の再生に失敗しました。画面の質問テキストをご覧ください。')
        onEnd?.() // TTS 失敗時もインタビューは続行
      })
  }, [showNotice, sessionId])

  // ── カメラ初期化 ─────────────────────────────────────
  useEffect(() => {
    // initCamera() 内の setState は await 後に実行されるため同期 setState ではない
    // eslint-disable-next-line react-hooks/set-state-in-effect
    initCamera()
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      screenStreamRef.current?.getTracks().forEach((t) => t.stop())
      speakVersionRef.current++ // 再生中の speak を無効化
      currentAudioRef.current?.pause()
      currentAudioRef.current = null
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      stopDetection()
      if (screenMediaRecorderRef.current?.state !== 'inactive') {
        screenMediaRecorderRef.current?.stop()
      }
      if (mediaRecorderRef.current?.state !== 'inactive') {
        mediaRecorderRef.current?.stop()
      }
      // service モード BroadcastChannel cleanup
      widgetChannelRef.current?.close()
      widgetChannelRef.current = null
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
      cancelAnimationFrame(screenDrawRafRef.current)
      if (stimulusIntervalRef.current) clearInterval(stimulusIntervalRef.current)
      if (stimulusTimeoutRef.current) clearTimeout(stimulusTimeoutRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 感情検出はインタビュー開始時に startInterview() 内で起動する。
  // こうすることで録画の t=0 と感情タイムスタンプの t=0 が一致する。

  // ── 離脱防止ガード: インタビュー開始後、回答が保存し終わるまでは閉じる前に警告 ──
  useEffect(() => {
    const started = phase !== 'guide' && phase !== 'waiting'
    if (!started || submitState === 'saved') return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [phase, submitState])

  // ── 進行中の文字起こしを逐次サーバー保存（途中離脱でも残す保険。AI 分析はしない）──
  function saveProgress() {
    if (!participantToken) return
    const fullText = transcriptRef.current.map((t) => `[${t.speaker}]: ${t.text}`).join('\n')
    const segments = transcriptRef.current.map((t) => ({
      speaker: t.speaker, text: t.text, start: t.start, end: t.end ?? t.start,
    }))
    fetch(`/api/sessions/${sessionId}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-participant-token': participantToken },
      body: JSON.stringify({ transcript: fullText, segments }),
    }).catch(() => {})
  }

  // ── 測定結果（タスク達成/断念・評価回答）を構造化してサーバー保存 ──
  // その時点の全件を送り、サーバー側は (sessionId, order) 単位で upsert する。
  // 並行送信・再送しても行が重複せず、遅延したリクエストが新しい結果を消すこともない。
  function saveResults() {
    if (!participantToken) return
    fetch(`/api/sessions/${sessionId}/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-participant-token': participantToken },
      body: JSON.stringify({
        taskResults: taskResultsRef.current,
        answers: answersRef.current,
      }),
    }).catch(() => {})
  }

  // ── テキスト入力で回答を送信 ──────────────────────────
  function submitTextAnswer() {
    const text = textInput.trim()
    if (!text || !onAnswerCallbackRef.current) return

    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    speechRef.current?.stop()
    setLiveText('')
    setIsListening(false)

    const entry: TranscriptEntry = {
      speaker: 'Participant',
      text,
      start: elapsedSec(startTimeRef.current),
      end: elapsedSec(startTimeRef.current),
    }
    transcriptRef.current = [...transcriptRef.current, entry]
    setTranscript([...transcriptRef.current])
    conversationBufferRef.current += `\n参加者: ${text}`

    setTextInput('')
    saveProgress()
    const callback = onAnswerCallbackRef.current
    onAnswerCallbackRef.current = null
    callback(text)
  }

  // ── Feature 1: 沈黙タイムアウト付き音声認識 ──────────
  function listenForAnswer(onAnswer: (answer: string) => void, silenceRetry = false) {
    // テキスト入力フォールバック用にコールバックを保存
    onAnswerCallbackRef.current = onAnswer

    if (typeof window === 'undefined') return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) as (new () => any) | undefined
    if (!SR) return // テキスト入力フォールバックで対応

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition: any = new SR()
    recognition.lang = 'ja-JP'
    recognition.continuous = true
    recognition.interimResults = true
    speechRef.current = recognition

    let finalText = ''
    const startTime = elapsedSec(startTimeRef.current)

    // 沈黙タイムアウト開始（60秒）— 考える時間・沈黙して内省する時間を確保する
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    silenceTimerRef.current = setTimeout(() => {
      recognition.stop()
      setLiveText('')
      if (!silenceRetry) {
        // 1回目のタイムアウト：促す
        speak('もう少し聞かせていただけますか？', () => {
          listenForAnswer(onAnswer, true)
        })
      } else {
        // 2回目のタイムアウト：次の質問へ
        speak('ありがとうございます。次の質問に移ります。', () => {
          onAnswer('')
        })
      }
    }, 60000)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      // 何か話し始めたらタイマーリセット
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript
        } else {
          interim = event.results[i][0].transcript
        }
      }
      setLiveText(finalText + interim)
    }

    recognition.onspeechend = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      recognition.stop()
      setLiveText('')
      setIsListening(false)
      // テキスト送信と二重発火しないよう、コールバックを一度だけ消費する
      if (finalText.trim() && onAnswerCallbackRef.current) {
        onAnswerCallbackRef.current = null
        const entry: TranscriptEntry = {
          speaker: 'Participant',
          text: finalText.trim(),
          start: startTime,
          end: elapsedSec(startTimeRef.current),
        }
        transcriptRef.current = [...transcriptRef.current, entry]
        setTranscript([...transcriptRef.current])
        conversationBufferRef.current += `\n参加者: ${finalText.trim()}`
        saveProgress()
        onAnswer(finalText.trim())
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (e: any) => {
      // no-speech / aborted は沈黙タイマーや通常停止で処理されるため無視
      if (e?.error === 'no-speech' || e?.error === 'aborted') return
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      setLiveText('')
      setIsListening(false)
      // コールバックは残す（下のテキスト入力で回答を継続できる）
      showNotice('音声認識が中断しました。もう一度話すか、下の入力欄にテキストで回答してください。')
    }

    recognition.start()
    setIsListening(true)
  }

  // ── Feature 5: 評価質問の回答送信 ────────────────────
  function submitRating(value: number, label: string) {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    const q = questions[currentQuestionIndexRef.current]
    const answerText = `${value}（${label}）`
    const entry: TranscriptEntry = {
      speaker: 'Participant',
      text: answerText,
      start: elapsedSec(startTimeRef.current),
    }
    transcriptRef.current = [...transcriptRef.current, entry]
    setTranscript([...transcriptRef.current])
    conversationBufferRef.current += `\n参加者: ${answerText}`
    saveProgress()

    // 評価スコアは数値として構造化保存（平均・NPS 集計用）
    if (q && (q.type === 'rating' || q.type === 'nps')) {
      const qIdx = currentQuestionIndexRef.current
      answersRef.current = [
        ...answersRef.current.filter((a) => a.order !== qIdx + 1),
        {
          questionId: q.id ?? null,
          order: qIdx + 1,
          text: q.text,
          type: q.type,
          valueNum: value,
          answeredAt: entry.start,
        },
      ]
      saveResults()
    }

    // 評価質問は AI 深掘りなし → 次へ
    if (q.type === 'nps' || q.type === 'rating') {
      moveToNextPlannedQuestion()
    } else {
      decideNext(answerText)
    }
  }

  // ── AI 深掘り判断 ─────────────────────────────────────
  async function decideNext(participantAnswer: string) {
    if (!participantAnswer.trim()) {
      moveToNextPlannedQuestion()
      return
    }
    setAiThinking(true)
    setPhase('thinking')
    try {
      const res = await fetch('/api/interviewer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plannedQuestion: questions[currentQuestionIndexRef.current].text,
          participantAnswer,
          followUpCount: followUpCountRef.current,
          conversationSoFar: conversationBufferRef.current,
          interviewTopic: interviewTitle,
        }),
      })
      const decision = await res.json()
      setAiThinking(false)
      setPhase('interview')
      if (decision.action === 'follow_up' && decision.question) {
        followUpCountRef.current += 1
        conversationBufferRef.current += `\nAI: ${decision.question}`
        setIsFollowUp(true)
        setDisplayedQuestion(decision.question)
        speak(decision.question, () => listenForAnswer(decideNext))
      } else {
        moveToNextPlannedQuestion()
      }
    } catch {
      setAiThinking(false)
      setPhase('interview')
      showNotice('通信エラーのため、次の質問に進みます。')
      moveToNextPlannedQuestion()
    }
  }

  // ── 次の設定質問へ ────────────────────────────────────
  // 自由回答を「どの質問に対する回答か」を紐づけて保存する。
  // 会話バッファ（深掘りのやり取りを含む）から参加者の発言だけを取り出してまとめる。
  function recordOpenAnswerIfAny() {
    const qIdx = currentQuestionIndexRef.current
    const q = questions[qIdx]
    if (!q || q.type !== 'open') return
    const utterances = conversationBufferRef.current
      .split('\n')
      .filter((l) => l.startsWith('参加者: '))
      .map((l) => l.slice('参加者: '.length).trim())
      .filter(Boolean)
    const said = utterances.join(' / ')
    if (!said) return
    // AI が実際に深掘りした回数。発話数から数えると、深掘りされたが
    // 沈黙・手動スキップで答えなかった分が抜けるため、カウンタの値を使う。
    // ※この関数は followUpCountRef のリセット前に呼ばれる前提（moveToNextPlannedQuestion 参照）
    const followUpCount = followUpCountRef.current
    answersRef.current = [
      ...answersRef.current.filter((a) => a.order !== qIdx + 1),
      {
        questionId: q.id ?? null,
        order: qIdx + 1,
        text: q.text,
        type: 'open',
        valueText: said,
        followUpCount,
        answeredAt: elapsedSec(startTimeRef.current),
      },
    ]
    saveResults()
  }

  function moveToNextPlannedQuestion() {
    recordOpenAnswerIfAny() // バッファをリセットする前に確定させる
    const next = currentQuestionIndexRef.current + 1
    followUpCountRef.current = 0
    conversationBufferRef.current = ''
    if (next >= questions.length) { endInterview(); return }

    currentQuestionIndexRef.current = next
    setCurrentQuestionIndex(next)
    setIsFollowUp(false)
    const q = questions[next]
    setDisplayedQuestion(q.text)
    conversationBufferRef.current = `AI: ${q.text}`

    speak(q.text, () => {
      if (q.type === 'open') {
        listenForAnswer(decideNext)
      }
      // rating / nps は UI で回答 → listenForAnswer は起動しない
    })
  }

  // ── 録画開始ヘルパー ──────────────────────────────────
  function startMediaRecorder() {
    if (!streamRef.current) return
    recordedChunksRef.current = []
    // 映像＋音声を録画（感情タイムスタンプと同期するため）
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(
      (t) => MediaRecorder.isTypeSupported(t)
    ) ?? ''
    const recorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : {})
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data)
    }
    recorder.start(1000) // 1秒ごとにチャンクを収集
    mediaRecorderRef.current = recorder
  }

  // ── タスクウィジェットを開く（Document PiP 優先 → ポップアップ fallback） ──
  // ⚠️ この関数は必ずユーザージェスチャーハンドラの中で、かつ window.open() より先に呼ぶこと
  //    （documentPictureInPicture.requestWindow() は transient user activation を要求する。
  //      window.open() が先に呼ばれるとトークンが消費されて PiP が失敗しポップアップに落ちる）
  async function openWidget() {
    // btoa の出力には + / = が含まれうる。URLSearchParams で + が空白に化けて
    // widget 側の atob/JSON.parse が失敗する（タスクが空表示になる）ため、必ず encode する。
    // 小窓が使うのは文言・順番・ヒントだけ。Task 行をそのまま渡すと interviewId 等も
    // URL に載る。ヒントを載せるようになった分 URL が伸びるので、必要な項目に絞る。
    const taskPayload = (tasks ?? []).map((t) => ({ text: t.text, order: t.order, hint: t.hint ?? null }))
    const tasksEncoded = encodeURIComponent(btoa(encodeURIComponent(JSON.stringify(taskPayload))))
    // 小窓（別ウィンドウの iframe）が古い版をキャッシュして表示するのを防ぐため、
    // 開くたびに一意なパラメータを付けて必ず最新を読み込ませる。
    const cacheBust = cacheBustToken()
    // サービス起動も小窓に一本化するため、対象サービスの URL を小窓へ渡す。
    const stimulusParam = stimulusUrl ? `&stimulus=${encodeURIComponent(stimulusUrl)}` : ''
    const seqParam = seqEnabled ? '&seq=1' : ''
    // 声かけまでの秒数。小窓側でもタスク着手からの経過を測って同じ案内を出す
    const hintParam = hintDelaySec && hintDelaySec > 0 ? `&hintdelay=${hintDelaySec}` : ''
    const url = `/interview/widget?session=${encodeURIComponent(sessionId)}&tasks=${tasksEncoded}&current=${currentTaskIndex}&_t=${cacheBust}${stimulusParam}${seqParam}${hintParam}`

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docPiP = (window as any).documentPictureInPicture
    if (docPiP) {
      try {
        // Document PiP: どのタブ・ウィンドウの上にも常時浮く小窓（Chrome 116+ / Google Meet と同じ仕組み）
        const pipWindow: Window = await docPiP.requestWindow({ width: 400, height: 560 })
        // ⚠️ html/body に高さを与えないと iframe の height:100% が解決できず、
        //    HTML デフォルトの 150px に潰れる（Chrome は補完するが Brave 等では潰れる）。
        //    高さの連鎖を明示し、iframe を窓いっぱいに広げる。
        pipWindow.document.documentElement.style.cssText = 'height:100%;'
        pipWindow.document.body.style.cssText = 'margin:0;padding:0;overflow:hidden;background:#ffffff;height:100%;'
        const iframe = pipWindow.document.createElement('iframe')
        iframe.src = url
        iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;'
        pipWindow.document.body.appendChild(iframe)
        pipWindowRef.current = pipWindow
        setWidgetBlocked(false)
        console.info('[UserVoice] Document PiP ウィジェット: 常時最前面で起動しました')
        return
      } catch (err) {
        // PiP 拒否・未対応 → ポップアップへ fallback
        console.warn('[UserVoice] Document PiP が失敗しました。ポップアップに切り替えます:', err)
      }
    }
    // ポップアップ fallback（最前面固定は不可）
    const popup = window.open(url, 'uservoice-widget', 'popup,width=400,height=560,top=40,left=40')
    if (popup) pipWindowRef.current = popup
    setWidgetBlocked(!popup)
  }

  // ── タスクの結果を記録して次へ（達成 / 断念）。最後のタスクなら質問フェーズへ ──
  function recordTaskOutcome(outcome: 'completed' | 'gave_up', seq?: number, usedHintFromWidget?: boolean) {
    const idx = currentTaskIndexRef.current
    const task = tasks?.[idx]
    // ヒントはメイン画面と小窓のどちらからでも開ける。どちらで見ても記録に残す
    const usedHint = usedHintOrdersRef.current.has(idx + 1) || usedHintFromWidget === true
    if (task) {
      // 定量データとして構造化保存（成功率・所要時間の集計用）
      const now = elapsedSec(startTimeRef.current)
      taskResultsRef.current = [
        ...taskResultsRef.current.filter((r) => r.order !== idx + 1), // 同一タスクの再記録は上書き
        {
          taskId: task.id ?? null,
          order: idx + 1,
          text: task.text,
          outcome,
          startedAt: taskStartedAtRef.current,
          endedAt: now,
          seq,
          usedHint,
        },
      ]
      saveResults()

      const base = outcome === 'completed' ? '達成' : '断念（たどり着けなかった）'
      const label = usedHint ? `${base}（ヒントあり）` : base
      const text = `タスク${idx + 1}「${task.text}」→ ${label}`
      const entry: TranscriptEntry = {
        speaker: 'System',
        text,
        start: elapsedSec(startTimeRef.current),
      }
      transcriptRef.current = [...transcriptRef.current, entry]
      setTranscript([...transcriptRef.current])
      conversationBufferRef.current += `\n[タスク記録] ${text}`
      saveProgress()
    }
    const total = tasks?.length ?? 0
    if (idx + 1 < total) {
      const next = idx + 1
      // 小窓への同期は gotoTask 内で行う（一覧からのジャンプでも必ず送るため）
      gotoTask(next)
    } else {
      completeTasksAndStartInterview()
    }
  }

  // ── タスク完了 → 事後インタビュー開始 ─────────────────
  function completeTasksAndStartInterview() {
    // ウィジェットを閉じる（BroadcastChannel 経由 + 直接 close）
    widgetChannelRef.current?.postMessage({ type: 'session_ended' })
    try { pipWindowRef.current?.close() } catch { /* ignore */ }
    pipWindowRef.current = null
    if (questions.length === 0) {
      endInterview()
      return
    }
    setPhase('intro')
    const intro = `お疲れ様でした。続いて、操作を通じて感じたことをいくつかお聞きします。`
    speak(intro, () => {
      setPhase('interview')
      currentQuestionIndexRef.current = 0
      setCurrentQuestionIndex(0)
      setIsFollowUp(false)
      const q = questions[0]
      setDisplayedQuestion(q.text)
      conversationBufferRef.current = `AI: ${q.text}`
      speak(q.text, () => {
        if (q.type === 'open') listenForAnswer(decideNext)
      })
    })
  }

  // ── インタビュー開始 ──────────────────────────────────
  async function startInterview() {
    if (startedRef.current) return  // 二重クリック・二重起動防止
    startedRef.current = true
    // 経過時間の基準を「開始ボタンを押した瞬間」に揃える。
    // マウント時のままだとガイド画面の滞在時間が所要時間に混入し、
    // 文字起こしのタイムスタンプも録画の再生位置とずれる。
    startTimeRef.current = nowMs()
    taskStartedAtRef.current = 0
    setIsRecording(true)
    startMediaRecorder()
    if (videoRef.current) startDetection(videoRef.current)

    // service モード: ウィンドウ系は await より前に呼ぶ（ユーザージェスチャー文脈を維持）
    if (interviewType === 'usability' && usabilityMode === 'service') {
      // BroadcastChannel を先にセットアップ
      const channel = new BroadcastChannel(`uservoice-widget-${sessionId}`)
      widgetChannelRef.current = channel
      channel.onmessage = (e) => {
        if (e.data.type === 'task_outcome') recordTaskOutcome(e.data.outcome === 'gave_up' ? 'gave_up' : 'completed', typeof e.data.seq === 'number' ? e.data.seq : undefined, e.data.usedHint === true)
        else if (e.data.type === 'task_complete') completeTasksAndStartInterview() // 後方互換
        else if (e.data.type === 'end_session') endInterview()
        else if (e.data.type === 'recording_started') setScreenSharing(true)
        else if (e.data.type === 'service_opened') setServiceOpened(true)
        else if (e.data.type === 'task_ready') markFirstTaskStart() // 小窓でタスクが見えた＝着手できる時点
        // 小窓でヒントを開いた。小窓を閉じて開き直しても記録が消えないよう、メイン側で保持する
        else if (e.data.type === 'hint_used' && typeof e.data.index === 'number') {
          usedHintOrdersRef.current.add(e.data.index + 1)
        }
        else if (e.data.type === 'screen_recording_blob') {
          const blob: Blob = e.data.blob
          if (blob.size > 0) {
            screenBlobRef.current = blob
            setScreenRecordingDownloadUrl(URL.createObjectURL(blob))
          }
        }
      }
      // ① ウィジェット（PiP or ポップアップ）を「最初に」開く
      //    ⚠️ documentPictureInPicture.requestWindow() は transient user activation が必要。
      //       window.open() より後に呼ぶとトークンが消費されて PiP が失敗するため、必ず先に呼ぶ。
      void openWidget()
      // ② サービスは自動 window.open しない：PiP がジェスチャーを消費した後の window.open は
      //    ポップアップブロックされ失敗の通知が出るだけ。代わりにタスク画面の
      //    「サービスを開く（新しいタブ）」実リンク（ブロッカー回避）から開いてもらう。
    }

    await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-participant-token': participantToken ?? '' },
      body: JSON.stringify({ status: 'active' }),
    })

    // ユーザビリティテスト → タスクフェーズへ（TTS なし）
    if (interviewType === 'usability') {
      // prototype のみ: iframe 上の操作をバックグラウンドで画面録画
      if (usabilityMode === 'prototype' && stimulusUrl) {
        // 画面選択ダイアログの操作時間をタスク1に含めないよう、選択が終わってから計測開始
        startScreenShare()
          .catch(() => {/* 録画失敗は無視して続行 */})
          .finally(() => markFirstTaskStart())
      } else if (usabilityMode !== 'service') {
        markFirstTaskStart()
      }
      // service モードは小窓の task_ready（録画開始＋サイトを開いた時点）を待って計測開始する
      setPhase('task')
      return
    }

    // 印象テストの場合: stimulus フェーズを挿入。
    // カウントダウンは「画像の読み込み完了後」に開始する（beginStimulusCountdown）。
    if (interviewType === 'impression' && stimulusUrl) {
      stimulusStartedRef.current = false
      stimulusProceededRef.current = false
      setStimulusError(false)
      setStimulusCountdown(stimulusDuration ?? 5)
      setPhase('stimulus')
      return
    }

    // 通常インタビュー
    setPhase('intro')
    const intro = `こんにちは${participantName ? `、${participantName}さん` : ''}。本日はインタビューにご参加いただきありがとうございます。「${interviewTitle}」についてお聞きします。`
    speak(intro, () => {
      if (questions.length === 0) { endInterview(); return }  // 質問ゼロでもクラッシュさせない
      setPhase('interview')
      currentQuestionIndexRef.current = 0
      setCurrentQuestionIndex(0)
      setIsFollowUp(false)
      const q = questions[0]
      setDisplayedQuestion(q.text)
      conversationBufferRef.current = `AI: ${q.text}`
      speak(q.text, () => {
        if (q.type === 'open') listenForAnswer(decideNext)
      })
    })
  }

  // ── 手動で次へ ────────────────────────────────────────
  function manualNext() {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    speechRef.current?.stop()    // 音声認識停止
    speakVersionRef.current++    // 再生中の TTS をキャンセル
    currentAudioRef.current?.pause()
    currentAudioRef.current = null
    setIsSpeaking(false)
    setLiveText('')
    moveToNextPlannedQuestion()
  }

  // ── 印象テスト: 最初の質問へ遷移（タイマー・スキップ・エラーから共用、二重実行防止）──
  function proceedFromStimulus() {
    if (stimulusProceededRef.current) return
    stimulusProceededRef.current = true
    if (stimulusIntervalRef.current) clearInterval(stimulusIntervalRef.current)
    if (stimulusTimeoutRef.current) clearTimeout(stimulusTimeoutRef.current)
    if (questions.length === 0) { endInterview(); return }  // 質問ゼロでもクラッシュさせない
    setPhase('interview')
    currentQuestionIndexRef.current = 0
    setCurrentQuestionIndex(0)
    setIsFollowUp(false)
    const q = questions[0]
    setDisplayedQuestion(q.text)
    conversationBufferRef.current = `AI: ${q.text}`
    speak(q.text, () => {
      if (q.type === 'open') listenForAnswer(decideNext)
    })
  }

  // 画像の読み込み完了後にカウントダウンを開始する（二重起動防止）
  function beginStimulusCountdown() {
    if (stimulusStartedRef.current || stimulusProceededRef.current) return
    stimulusStartedRef.current = true
    const duration = stimulusDuration ?? 5
    setStimulusCountdown(duration)
    stimulusIntervalRef.current = setInterval(() => {
      setStimulusCountdown((prev) => {
        if (prev <= 1) { if (stimulusIntervalRef.current) clearInterval(stimulusIntervalRef.current); return 0 }
        return prev - 1
      })
    }, 1000)
    stimulusTimeoutRef.current = setTimeout(() => proceedFromStimulus(), duration * 1000)
  }

  // ── インタビュー終了 ──────────────────────────────────
  async function endInterview() {
    if (endedRef.current) return  // 二重実行防止（結果・録画の二重送信を防ぐ）
    endedRef.current = true
    // SEQ 入力待ちのまま終了された場合、押した達成/断念を取りこぼさない（評価なしで確定）
    if (awaitingSeq) {
      const pending = awaitingSeq
      setAwaitingSeq(null)
      recordTaskOutcome(pending)
    }
    recordOpenAnswerIfAny()  // 回答途中で終了した場合も取りこぼさない
    saveResults()            // 測定結果の最終フラッシュ（送信失敗していた分の再送を兼ねる）
    // ウィジェットを閉じる（BroadcastChannel 経由 + 直接 close）
    widgetChannelRef.current?.postMessage({ type: 'session_ended' })
    try { pipWindowRef.current?.close() } catch { /* ignore */ }
    pipWindowRef.current = null
    setPhase('ending')
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    speechRef.current?.stop()
    speak('ご回答いただきありがとうございました。本日のインタビューはこれで終了です。貴重なお時間をありがとうございました。', async () => {
      await submitResults()
      setPhase('done')
    })
  }

  // ── 録音停止 → Blob を返す ────────────────────────────
  function stopMediaRecorder(): Promise<Blob> {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        resolve(new Blob([], { type: 'audio/webm' }))
        return
      }
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm'
        resolve(new Blob(recordedChunksRef.current, { type: mimeType }))
      }
      recorder.stop()
    })
  }

  async function submitResults() {
    setSubmitState('saving')  // 'ending' フェーズ中にアップロード中の表示を出せるよう先に立てる
    const isUsability = interviewType === 'usability'
    const faceBlob = await stopMediaRecorder()          // 顔＋音声
    const screenComposite = await stopScreenRecorder()  // プロトタイプ: 画面＋顔＋音声の合成
    // サービスモードは小窓から届いた合成 Blob を使う
    const compositeBlob = screenComposite.size > 0 ? screenComposite : screenBlobRef.current

    // ローカル DL 用 URL
    if (!isUsability && faceBlob.size > 0) setRecordingDownloadUrl(URL.createObjectURL(faceBlob))
    if (compositeBlob && compositeBlob.size > 0) setScreenRecordingDownloadUrl(URL.createObjectURL(compositeBlob))

    // サーバー保存: ユーザビリティは「画面＋顔＋音声」の合成、それ以外は顔録画。
    // Vercel Blob クライアント直アップロードで関数の 4.5MB ボディ制限を回避し、非公開保存する。
    const uploadBlob = isUsability
      ? (compositeBlob && compositeBlob.size > 0 ? compositeBlob : (faceBlob.size > 0 ? faceBlob : null))
      : (faceBlob.size > 0 ? faceBlob : null)
    if (uploadBlob) {
      try {
        await upload(`recordings/${sessionId}.webm`, uploadBlob, {
          access: 'private',
          contentType: 'video/webm',
          handleUploadUrl: `/api/sessions/${sessionId}/recording`,
          clientPayload: participantToken ?? '',
        })
      } catch (e) {
        console.error('録画のアップロードに失敗しました（ローカル保存は可能）:', e)
        showNotice('録画のサーバー保存に失敗しました。完了画面からダウンロードして共有してください。')
      }
    }

    await persistResults()
  }

  // ── 文字起こし・感情をサーバーへ保存（失敗時に再送可能）──
  async function persistResults() {
    setSubmitState('saving')
    // status 更新はベストエフォート（失敗してもデータ保存を優先）
    await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-participant-token': participantToken ?? '' },
      body: JSON.stringify({ status: 'completed' }),
    }).catch(() => {})

    const fullText = transcriptRef.current.map((t) => `[${t.speaker}]: ${t.text}`).join('\n')
    const segments = transcriptRef.current.map((t) => ({
      speaker: t.speaker, text: t.text, start: t.start, end: t.end ?? t.start + 5,
    }))
    try {
      const res = await fetch(`/api/sessions/${sessionId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-participant-token': participantToken ?? '' },
        body: JSON.stringify({ transcript: fullText, segments, emotions: getSnapshots() }),
      })
      if (!res.ok) throw new Error(`process failed: ${res.status}`)
      track('interview_completed', { sessionId })
      setSubmitState('saved')
    } catch (e) {
      console.error('結果の送信に失敗しました:', e)
      track('interview_process_failed', { sessionId })
      setSubmitState('failed')
      showNotice('回答の送信に失敗しました。完了画面から再送信できます。')
    }
  }

  // ── 画面共有開始 ──────────────────────────────────────
  async function startScreenShare() {
    try {
      // 「画面全体」を既定に寄せる（どのタブを操作しても対象に含め、選び間違いを防ぐ）
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor' }, audio: false })
      screenStreamRef.current = stream
      // For 'service' mode: show in video element
      if (usabilityMode === 'service' && screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream
      }

      // 画面に顔(PiP)を重ね、マイク音声も載せて「画面＋顔＋音声」を1ファイルに合成する
      const screenVid = document.createElement('video')
      screenVid.srcObject = stream
      screenVid.muted = true
      await new Promise<void>((resolve) => {
        screenVid.onloadedmetadata = () => screenVid.play().then(resolve).catch(() => resolve())
      })

      const W = Math.min(screenVid.videoWidth || 1280, 1920)
      const H = Math.min(screenVid.videoHeight || 720, 1080)
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')!
      const webcamVid = videoRef.current

      const draw = () => {
        ctx.drawImage(screenVid, 0, 0, W, H)
        if (webcamVid && webcamVid.readyState >= 2 && webcamVid.videoWidth) {
          const pipW = Math.round(W * 0.18)
          const pipH = Math.round(pipW * (webcamVid.videoHeight / webcamVid.videoWidth))
          const x = W - pipW - 16
          const y = H - pipH - 16
          ctx.drawImage(webcamVid, x, y, pipW, pipH)
          ctx.strokeStyle = 'rgba(255,255,255,0.85)'
          ctx.lineWidth = 2
          ctx.strokeRect(x, y, pipW, pipH)
        }
        screenDrawRafRef.current = requestAnimationFrame(draw)
      }
      draw()

      const canvasStream = canvas.captureStream(25)
      // マイク音声（顔ストリームの音声トラック）を合成に追加
      const micTrack = streamRef.current?.getAudioTracks?.()[0]
      if (micTrack) canvasStream.addTrack(micTrack)

      screenRecordedChunksRef.current = []
      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(
        (t) => MediaRecorder.isTypeSupported(t)
      ) ?? ''
      const recorder = new MediaRecorder(canvasStream, mimeType ? { mimeType } : {})
      recorder.ondataavailable = (e) => { if (e.data.size > 0) screenRecordedChunksRef.current.push(e.data) }
      recorder.start(1000)
      screenMediaRecorderRef.current = recorder
      setScreenSharing(true)
      stream.getVideoTracks()[0].onended = () => {
        setScreenSharing(false)
        cancelAnimationFrame(screenDrawRafRef.current)
        screenStreamRef.current = null
      }
    } catch {
      setScreenShareError('画面共有を開始できませんでした')
    }
  }

  // ── 画面録画停止 → Blob を返す ────────────────────────
  function stopScreenRecorder(): Promise<Blob> {
    return new Promise((resolve) => {
      cancelAnimationFrame(screenDrawRafRef.current)
      const recorder = screenMediaRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        resolve(new Blob([], { type: 'video/webm' }))
        return
      }
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'video/webm'
        resolve(new Blob(screenRecordedChunksRef.current, { type: mimeType }))
      }
      recorder.stop()
    })
  }

  const progress = ((currentQuestionIndex + 1) / questions.length) * 100
  const currentQ = questions[currentQuestionIndex]

  // ── ブラウザチェック画面 ──────────────────────────────
  if (speechSupported === false && !textOnlyMode) {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col items-center justify-center p-8">
        <div className="max-w-md w-full bg-white border border-gray-200 rounded-xl p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto mb-4">
            <Globe className="w-5 h-5 text-amber-600" strokeWidth={1.75} />
          </div>
          <h1 className="text-lg font-semibold text-gray-900 mb-2 tracking-tight">推奨ブラウザでアクセスしてください</h1>
          <p className="text-gray-600 text-sm mb-6 leading-relaxed">
            このインタビューは音声認識を使用します。<br />
            現在のブラウザ（Brave など）では音声認識がブロックされているため、
            <span className="text-gray-900 font-medium"> Google Chrome または Microsoft Edge </span>
            で開いてください。
          </p>

          {/* URL コピーボタン */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6 text-left">
            <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide font-medium">このページの URL を Chrome / Edge で開く</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={typeof window !== 'undefined' ? window.location.href : ''}
                className="flex-1 bg-white border border-gray-300 rounded-md px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-gray-900"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href)
                  alert('URLをコピーしました')
                }}
                className="inline-flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap"
              >
                <Copy className="w-3 h-3" strokeWidth={2} />
                コピー
              </button>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-5">
            <p className="text-xs text-gray-500 mb-3">または、テキスト入力のみで続けることもできます</p>
            <button
              onClick={() => { track('interview_speech_fallback', { sessionId }); setTextOnlyMode(true) }}
              className="inline-flex items-center gap-1.5 text-sm text-gray-700 hover:text-gray-900 border border-gray-300 hover:border-gray-400 px-4 py-1.5 rounded-md transition-colors"
            >
              テキスト入力で続ける
              <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-white text-gray-900 flex flex-col overflow-hidden">
      {/* 一時通知トースト（TTS 失敗・通信エラーなど） */}
      {notice && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg max-w-md">
          <AlertCircle className="w-4 h-4 flex-shrink-0" strokeWidth={2} />
          <span>{notice}</span>
        </div>
      )}
      {/* ヘッダー */}
      <div className="border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="text-base font-semibold tracking-tight text-gray-900">UserVoice</span>
          <span className="text-gray-300">/</span>
          <span className="text-gray-600 text-sm">{interviewTitle}</span>
        </div>
        {isRecording && (
          <span className="flex items-center gap-1.5 text-red-600 text-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            録音中
          </span>
        )}
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
        {/* 左：カメラ（左カラムいっぱいに表示、絶対配置で高さ変動なし）。
            モバイルでは縦積みになり潰れないよう最低高さを確保する。 */}
        <div className="relative overflow-hidden bg-gray-900 h-[42vh] md:h-auto flex-shrink-0 md:flex-shrink md:flex-1">

          {/* カメラ映像：常時マウント（許可後に再アタッチできるよう、エラー時も要素は残す）。
              エラー時はオーバーレイを最前面(z-30)に重ねる。 */}
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            aria-label="あなたのカメラ映像"
            className={
              cameraError
                ? 'hidden'
                : interviewType === 'usability' && (phase === 'task' || phase === 'interview' || phase === 'thinking' || phase === 'intro' || phase === 'waiting')
                  ? 'absolute bottom-4 right-4 w-44 h-28 object-cover scale-x-[-1] rounded-lg border border-white/20 z-20 shadow-xl'
                  : 'absolute inset-0 w-full h-full object-cover scale-x-[-1]'
            }
          />
          {cameraError && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-gray-100 px-6 text-center">
              <AlertCircle className="w-6 h-6 text-gray-400" strokeWidth={1.75} />
              <p className="text-gray-700 text-sm font-medium">カメラ・マイクが利用できません</p>
              <p className="text-gray-500 text-xs leading-relaxed max-w-xs">
                ブラウザのアドレスバーのカメラアイコンから「許可」を選択し、再試行してください。
                他のアプリがカメラを使用している場合は終了してください。
              </p>
              <button
                onClick={() => initCamera()}
                className="mt-1 inline-flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
              >
                カメラを許可して再試行
              </button>
            </div>
          )}

          {/* 顔フレーミング警告。カメラが小型PiP（ユーザビリティ時）か全画面（通常時）かで位置を変える。
              見切れ・未検出のときだけ出す。 */}
          {!cameraError && (faceStatus === 'no_face' || faceStatus === 'cut_off') && (
            (() => {
              const cameraIsPip = interviewType === 'usability' && (phase === 'task' || phase === 'interview' || phase === 'thinking' || phase === 'intro' || phase === 'waiting')
              const msg = faceStatus === 'no_face'
                ? '顔が写っていません。カメラに顔が入るように調整してください'
                : '顔が見切れています。中央に顔が来るように位置を調整してください'
              return (
                <div
                  className={
                    cameraIsPip
                      ? 'absolute bottom-[8.5rem] right-4 w-44 z-20 flex items-start gap-1.5 bg-amber-500/95 text-white px-2 py-1.5 rounded-lg shadow-lg'
                      : 'absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-amber-500/95 text-white px-3.5 py-2 rounded-lg shadow-lg max-w-[90%]'
                  }
                >
                  <AlertTriangle className={cameraIsPip ? 'w-3.5 h-3.5 flex-shrink-0 mt-0.5' : 'w-4 h-4 flex-shrink-0'} strokeWidth={2.25} />
                  <span className={cameraIsPip ? 'text-[10px] font-medium leading-snug' : 'text-xs font-medium leading-snug'}>{msg}</span>
                </div>
              )
            })()
          )}

          {/* プロトタイプテスト: iframe */}
          {interviewType === 'usability' && usabilityMode === 'prototype' && stimulusUrl && (phase === 'task' || phase === 'interview' || phase === 'thinking' || phase === 'intro' || phase === 'waiting') && (
            <div className="absolute inset-0">
              <iframe
                src={stimulusUrl.includes('figma.com') ? `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(stimulusUrl)}` : stimulusUrl}
                className="w-full h-full border-0"
                allowFullScreen
              />
            </div>
          )}

          {/* ユーザビリティテスト(service): ウェブカメラが全画面表示（サービスは別ウィンドウで操作） */}

          {/*
            感情の検出状況・判定結果は参加者に見せない。
            自分がどう判定されているかが見えると、それを意識して振る舞いが変わり、
            測ろうとしている自然な反応そのものが歪む（観察者効果）。
            準備中であることは開始ボタン側に出しており、検出エラーは参加者には
            対処できず進行も止めないため、不安を与えるだけで伝える意味がない。
            顔の見切れ警告だけは参加者が直せるので残している（上部）。
          */}

          {/* AI ステータスバッジ（左下オーバーレイ） */}
          {isSpeaking && (
            <div className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 bg-gray-900 text-white text-xs px-3 py-1.5 rounded-full shadow-lg">
              <Sparkles className="w-3 h-3 animate-pulse" strokeWidth={2} />
              AI が話しています
            </div>
          )}
          {aiThinking && (
            <div className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 bg-amber-500 text-white text-xs px-3 py-1.5 rounded-full shadow-lg">
              <Sparkles className="w-3 h-3 animate-pulse" strokeWidth={2} />
              AI が考えています
            </div>
          )}

          {/* 案内フェーズ（オーバーレイ） */}
          {phase === 'guide' && (
            <div className="absolute inset-0 bg-gray-950/40 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8 overflow-y-auto">
              <div className="text-center max-w-lg w-full bg-white rounded-2xl border border-gray-200 shadow-xl p-8">
                <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-gray-100 flex items-center justify-center text-gray-700">
                  {interviewType === 'impression' ? <ImageIcon className="w-5 h-5" strokeWidth={1.75} />
                    : interviewType === 'usability' && usabilityMode === 'prototype' ? <Palette className="w-5 h-5" strokeWidth={1.75} />
                    : interviewType === 'usability' ? <Monitor className="w-5 h-5" strokeWidth={1.75} />
                    : <Mic className="w-5 h-5" strokeWidth={1.75} />}
                </div>
                <span className="inline-block mb-3 text-[10px] px-2 py-0.5 rounded-md border border-gray-300 text-gray-700 bg-gray-50 font-medium uppercase tracking-wide">
                  {interviewType === 'impression' ? '印象テスト'
                    : interviewType === 'usability' && usabilityMode === 'prototype' ? 'プロトタイプテスト'
                    : interviewType === 'usability' ? 'ユーザビリティテスト'
                    : 'インタビュー'}
                </span>
                <h1 className="text-xl font-semibold tracking-tight mb-4 text-gray-900">{interviewTitle}</h1>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-5 text-left mb-5 space-y-3">
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                    {interviewType === 'usability' ? 'テストの流れ' : 'インタビューの流れ'}
                  </p>
                  {interviewType === 'usability' ? (
                    <ul className="space-y-2 text-sm text-gray-700">
                      <li className="flex gap-2.5"><span className="text-gray-400 flex-shrink-0 font-medium">1.</span>カメラ・マイクを許可してください</li>
                      {usabilityMode === 'prototype' ? (
                        <>
                          <li className="flex gap-2.5"><span className="text-gray-400 flex-shrink-0 font-medium">2.</span>画面にプロトタイプが表示されます。タスクに沿って操作してください</li>
                          <li className="flex gap-2.5"><span className="text-gray-400 flex-shrink-0 font-medium">3.</span>気づいたこと・感じたことを声に出しながら操作してください（シンクアラウド）</li>
                          <li className="flex gap-2.5"><span className="text-gray-400 flex-shrink-0 font-medium">4.</span>操作が終わったら「達成して質問へ」（できなければ「できなかった」）を押してください。その後、簡単な質問があります</li>
                        </>
                      ) : (
                        <>
                          <li className="flex gap-2.5"><span className="text-gray-400 flex-shrink-0 font-medium">2.</span>
                            <span>「開始する」を押すと<span className="text-gray-900 font-medium">タスク用の小窓</span>が表示されます（どのタブを操作していても<span className="text-gray-900 font-medium">常に最前面</span>）</span>
                          </li>
                          <li className="flex gap-2.5"><span className="text-gray-400 flex-shrink-0 font-medium">3.</span>
                            <span>画面の<span className="inline-flex items-center gap-1 text-gray-900 font-medium"><Globe className="w-3 h-3 inline" strokeWidth={2} />サービスを開く（新しいタブ）</span>を押して、テスト対象のサービスを開いてください</span>
                          </li>
                          <li className="flex gap-2.5"><span className="text-gray-400 flex-shrink-0 font-medium">4.</span>
                            <span>小窓の <span className="inline-flex items-center gap-1 text-red-600 font-medium"><Monitor className="w-3 h-3 inline" strokeWidth={2} />画面録画を開始する</span> を<strong className="text-gray-900">必ず押し</strong>、ダイアログで<strong className="text-gray-900">「画面全体」</strong>を選んで共有してから操作を始めてください</span>
                          </li>
                          <li className="flex gap-2.5"><span className="text-gray-400 flex-shrink-0 font-medium">5.</span>タスクに沿ってサービスを操作しながら、気づいたこと・感じたことを声に出してください（シンクアラウド）</li>
                          <li className="flex gap-2.5"><span className="text-gray-400 flex-shrink-0 font-medium">6.</span>操作が終わったら小窓の「達成して質問へ」（できなければ「できなかった」）を押してください</li>
                        </>
                      )}
                    </ul>
                  ) : (
                    <ul className="space-y-2 text-sm text-gray-700">
                      <li className="flex gap-2.5"><span className="text-gray-400 flex-shrink-0 font-medium">1.</span>カメラ・マイクを許可してください</li>
                      <li className="flex gap-2.5"><span className="text-gray-400 flex-shrink-0 font-medium">2.</span>AI が質問を音声で読み上げます（{questions.length} 問 + 深掘り）</li>
                      <li className="flex gap-2.5"><span className="text-gray-400 flex-shrink-0 font-medium">3.</span>マイクに向かって自由に話してください</li>
                      <li className="flex gap-2.5"><span className="text-gray-400 flex-shrink-0 font-medium">4.</span>回答が終わったら AI が自動で次の質問に進みます</li>
                    </ul>
                  )}
                  <div className="pt-2 border-t border-gray-200 text-xs text-gray-500 space-y-1">
                    <p>・静かな場所で、イヤホンなしで参加することをお勧めします</p>
                    <p>・表情・音声・操作内容が録画・分析されます</p>
                  </div>
                </div>
                <button
                  onClick={startInterview}
                  disabled={!cameraReady || emotionStatus === 'loading'}
                  className="inline-flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-50 disabled:cursor-wait px-6 py-2.5 rounded-md font-medium text-sm transition-colors"
                >
                  {!cameraReady || emotionStatus === 'loading' ? '準備中...' : (<>インタビューを開始する<ArrowRight className="w-4 h-4" strokeWidth={2} /></>)}
                </button>
                {(!cameraReady || emotionStatus === 'loading') && (
                  <p className="text-xs text-gray-500 mt-2 animate-pulse">カメラと解析モデルを初期化中</p>
                )}
              </div>
            </div>
          )}


          {/* 印象テスト: 刺激表示フェーズ */}
          {phase === 'stimulus' && stimulusUrl && (
            <div className="absolute inset-0 bg-gray-50 flex items-center justify-center">
              {stimulusError ? (
                // 画像読み込み失敗時のフォールバック
                <div className="text-center px-8">
                  <AlertCircle className="w-6 h-6 text-gray-400 mx-auto mb-3" strokeWidth={1.75} />
                  <p className="text-sm text-gray-700 mb-1">画像を読み込めませんでした</p>
                  <p className="text-xs text-gray-500 mb-4">そのまま質問に進んでいただけます。</p>
                  <button
                    onClick={proceedFromStimulus}
                    className="inline-flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                  >
                    質問に進む<ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
                  </button>
                </div>
              ) : (
                <>
                  <img
                    src={stimulusUrl}
                    alt="提示画像"
                    className="max-w-full max-h-full object-contain"
                    // 読み込み完了後にカウント開始（それまでタイマーは走らせない）
                    onLoad={beginStimulusCountdown}
                    onError={() => setStimulusError(true)}
                  />
                  {stimulusCountdown > 0 && (
                    <div className="absolute bottom-6 right-6 w-12 h-12 rounded-full bg-gray-900 text-white flex items-center justify-center text-xl font-semibold shadow-lg">
                      {stimulusCountdown}
                    </div>
                  )}
                  {/* 「もう見た」場合に早送りできるスキップ */}
                  <button
                    onClick={proceedFromStimulus}
                    className="absolute bottom-6 left-6 text-xs text-gray-600 hover:text-gray-900 bg-white/90 border border-gray-300 hover:border-gray-400 px-3 py-1.5 rounded-md transition-colors"
                  >
                    質問に進む →
                  </button>
                </>
              )}
            </div>
          )}

          {/* ユーザビリティテスト: タスクフェーズオーバーレイ */}
          {phase === 'task' && interviewType === 'usability' && (
            <div className="absolute inset-0 bg-gray-950/40 backdrop-blur-sm flex items-end justify-center py-4 sm:pb-8 z-10 overflow-y-auto">
              <div className="bg-white border border-gray-200 rounded-xl shadow-xl p-5 max-w-md w-full mx-4 my-auto space-y-4">
                {/* 通常の service モード（小窓が開いている）は、タスク文言を小窓に一本化するため
                    メイン画面には出さない。プロトタイプモードと、小窓が開けなかったフォールバック時のみ表示。 */}
                {tasks && tasks.length > 0 && !(usabilityMode === 'service' && !widgetBlocked) && (
                  <div>
                    <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-wide font-medium">
                      タスク {currentTaskIndex + 1} / {tasks.length}
                    </p>
                    <p className="text-sm text-gray-900 font-medium leading-relaxed">
                      {tasks[currentTaskIndex]?.text}
                    </p>
                  </div>
                )}

                {/* タスク文言と同じ条件で出す。service モードで小窓が生きているときは
                    操作も文言も小窓に一本化しているので、ここに「できなかったで次へ」と
                    案内しても、その操作がこの画面には無い。ヒントの二重露出も防ぐ。
                    SEQ の入力待ち中も出さない（達成を押した後にヒントを開くと、
                    自力の成功が「ヒントあり」に化けてしまうため）。 */}
                {stuckOnTask && !awaitingSeq && !(usabilityMode === 'service' && !widgetBlocked) && (
                  <StuckHelp
                    hint={tasks?.[currentTaskIndex]?.hint ?? null}
                    hintShown={hintShown}
                    onRevealHint={revealHint}
                  />
                )}

                {usabilityMode === 'service' ? (
                  widgetBlocked ? (
                    /* ── 詰み防止フォールバック ──
                       小窓を開けなかった場合のみ、この本体タブにフル操作を出す。
                       通常時（小窓あり）は操作を小窓へ集約し、ここには出さない。 */
                    <div className="space-y-3">
                      <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-800 leading-relaxed">
                        小窓を開けませんでした（ブラウザにブロックされた可能性があります）。アドレスバー右端でポップアップを許可して「小窓を再度開く」を押すか、このままこの画面で操作を続けてください（録画ダイアログでは<strong>「画面全体」</strong>を選択）。
                      </div>
                      <button
                        onClick={openWidget}
                        className="w-full inline-flex items-center justify-center gap-1.5 border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-xs font-medium transition-colors"
                      >
                        <AppWindow className="w-3.5 h-3.5" strokeWidth={2} />
                        小窓を再度開く
                      </button>
                      {screenSharing ? (
                        <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-md bg-red-50 border border-red-200 text-red-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                          画面録画中
                        </div>
                      ) : (
                        <button
                          onClick={() => startScreenShare()}
                          className="w-full inline-flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-md text-xs font-semibold transition-colors"
                        >
                          <Monitor className="w-3.5 h-3.5" strokeWidth={2} />
                          画面録画を開始する（画面全体を選択）
                        </button>
                      )}
                      {stimulusUrl && (
                        <a
                          href={stimulusUrl}
                          target="uservoice-service"
                          rel="noopener noreferrer"
                          onClick={markFirstTaskStart}  // 小窓なしフォールバック時の計測開始
                          className="w-full inline-flex items-center justify-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-3 py-2.5 rounded-md text-sm font-medium transition-colors"
                        >
                          <Globe className="w-4 h-4" strokeWidth={2} />
                          サービスを開く（新しいタブ）
                        </a>
                      )}
                      {awaitingSeq ? (
                        <div className="pt-2 border-t border-gray-200">
                          <SeqScale onSelect={commitSeq} />
                          <button onClick={() => setAwaitingSeq(null)} className="mt-2 w-full text-xs text-gray-500 hover:text-gray-900 py-1">戻る</button>
                        </div>
                      ) : (
                      <div className="flex gap-2 pt-2 border-t border-gray-200">
                        <button
                          onClick={() => handleTaskOutcome('completed')}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                          達成して{(tasks?.length ?? 0) <= currentTaskIndex + 1 ? '質問へ' : '次へ'}
                        </button>
                        <button
                          onClick={() => handleTaskOutcome('gave_up')}
                          className="border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 px-4 py-2 rounded-md text-sm transition-colors"
                        >
                          できなかった
                        </button>
                      </div>
                      )}
                      <button
                        onClick={endInterview}
                        className="w-full text-xs text-gray-500 hover:text-gray-800 py-1 transition-colors"
                      >
                        セッションを終了する
                      </button>
                    </div>
                  ) : (
                    /* ── 通常時 ──
                       操作・タスク文言はすべて右下の小窓に集約。メイン画面は「小窓を見てください」の
                       案内と、小窓を誤って閉じたときの復帰手段（再度開く）だけにする。 */
                    <div className="space-y-4 text-center">
                      <div className="flex items-center justify-center">
                        <div className="w-11 h-11 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center">
                          <AppWindow className="w-5 h-5 text-blue-600" strokeWidth={1.75} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-gray-900 font-medium">右下の小窓を見て操作してください</p>
                        <p className="text-xs text-gray-500 leading-relaxed">タスクと操作ボタンは、常に最前面に表示される右下の小窓にまとまっています。この画面での操作は不要です。</p>
                      </div>
                      {/* 進捗ステップ（小窓での手続きを可視化）: ①録画 → ②サイトアクセス → ③テスト開始。
                          小窓からの recording_started / service_opened を受けて現在地を進める。 */}
                      {(() => {
                        const steps = [
                          { label: '録画', done: screenSharing },
                          { label: 'サイトアクセス', done: serviceOpened },
                          { label: 'テスト開始', done: false },
                        ]
                        // 現在アクティブなステップ = 最初の未完了ステップ
                        const activeIdx = steps.findIndex((s) => !s.done)
                        return (
                          <div className="flex items-center justify-center gap-1 pt-1">
                            {steps.map((s, i) => {
                              const state = s.done ? 'done' : i === activeIdx ? 'active' : 'todo'
                              return (
                                <div key={s.label} className="flex items-center gap-1">
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold ${
                                        state === 'done'
                                          ? 'bg-emerald-500 text-white'
                                          : state === 'active'
                                          ? 'bg-blue-600 text-white'
                                          : 'bg-gray-200 text-gray-500'
                                      }`}
                                    >
                                      {state === 'done' ? <Check className="w-3 h-3" strokeWidth={3} /> : i + 1}
                                    </span>
                                    <span
                                      className={`text-[11px] ${
                                        state === 'todo' ? 'text-gray-400' : 'text-gray-700 font-medium'
                                      }`}
                                    >
                                      {s.label}
                                    </span>
                                  </div>
                                  {i < steps.length - 1 && (
                                    <span className={`w-4 h-px ${steps[i].done ? 'bg-emerald-400' : 'bg-gray-200'}`} />
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )
                      })()}
                      <button
                        onClick={openWidget}
                        className="w-full inline-flex items-center justify-center gap-1.5 text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-md text-xs transition-colors"
                      >
                        <AppWindow className="w-3.5 h-3.5" strokeWidth={2} />
                        小窓が見当たらないときは再度開く
                      </button>
                    </div>
                  )
                ) : (
                  <div className="space-y-2">
                    {/* 画面録画の状態（オフなら目立つ CTA を出す） */}
                    {!screenSharing && (
                      <div className="bg-amber-50 border border-amber-200 rounded-md p-2.5 text-xs text-amber-900 space-y-2">
                        <p className="flex items-center gap-1.5 font-medium">
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2} />
                          画面録画がオフです
                        </p>
                        <button
                          onClick={() => startScreenShare()}
                          className="w-full inline-flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-md text-xs font-semibold transition-colors"
                        >
                          <Monitor className="w-3.5 h-3.5" strokeWidth={2} />
                          録画を開始（画面全体を選択）
                        </button>
                      </div>
                    )}
                    {awaitingSeq ? (
                      <div className="border border-gray-200 rounded-md p-3 bg-gray-50">
                        <SeqScale onSelect={commitSeq} />
                        <button onClick={() => setAwaitingSeq(null)} className="mt-2 w-full text-xs text-gray-500 hover:text-gray-900 py-1">戻る</button>
                      </div>
                    ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleTaskOutcome('completed')}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2.5 rounded-md text-sm font-medium transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                        達成して{(tasks?.length ?? 0) <= currentTaskIndex + 1 ? '質問へ' : '次へ'}
                      </button>
                      <button
                        onClick={() => handleTaskOutcome('gave_up')}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 px-4 py-2.5 rounded-md text-sm transition-colors"
                      >
                        できなかった
                      </button>
                    </div>
                    )}
                    <button
                      onClick={endInterview}
                      className="w-full text-xs text-gray-500 hover:text-gray-800 py-1 transition-colors"
                    >
                      セッションを終了する
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 評価質問（オーバーレイ） */}
          {phase === 'interview' && !isSpeaking && currentQ?.type === 'rating' && (
            <div className="absolute inset-0 bg-gray-950/40 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8 overflow-y-auto">
              <div className="bg-white rounded-xl border border-gray-200 shadow-xl p-8">
                <RatingQuestion
                  question={currentQ.text}
                  onSubmit={(v) => submitRating(v, `${v} / 5`)}
                />
              </div>
            </div>
          )}
          {phase === 'interview' && !isSpeaking && currentQ?.type === 'nps' && (
            <div className="absolute inset-0 bg-gray-950/40 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8 overflow-y-auto">
              <div className="bg-white rounded-xl border border-gray-200 shadow-xl p-8">
                <NpsQuestion
                  question={currentQ.text}
                  onSubmit={(v) => submitRating(v, `${v} / 10`)}
                />
              </div>
            </div>
          )}

          {/* 終了処理中（録画アップロード・保存中）のオーバーレイ */}
          {phase === 'ending' && (
            <div className="absolute inset-0 z-30 bg-gray-950/40 backdrop-blur-sm flex items-center justify-center">
              <div className="text-center max-w-md px-8 bg-white rounded-2xl border border-gray-200 shadow-xl py-10">
                <div className="w-10 h-10 rounded-full border-2 border-gray-200 border-t-gray-900 animate-spin mx-auto mb-5" />
                <h2 className="text-lg font-semibold tracking-tight mb-2 text-gray-900">録画を保存しています</h2>
                <p className="text-gray-600 text-sm">アップロード中です。<strong className="text-gray-900 font-medium">このページを閉じないでください。</strong></p>
              </div>
            </div>
          )}

          {/* 完了画面（オーバーレイ）— ダッシュボードボタンなし */}
          {phase === 'done' && (
            <div className="absolute inset-0 bg-gray-950/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
              <div className="text-center max-w-md px-8 bg-white rounded-2xl border border-gray-200 shadow-xl py-10">
                <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-5">
                  <CheckCircle2 className="w-7 h-7 text-emerald-600" strokeWidth={1.5} />
                </div>
                <h2 className="text-xl font-semibold tracking-tight mb-2 text-gray-900">インタビュー完了</h2>
                <p className="text-gray-600 text-sm mb-4">ご回答いただきありがとうございました。</p>

                {/* 送信状態 */}
                {submitState === 'saving' && (
                  <p className="text-gray-500 text-xs mb-4 animate-pulse">回答を送信しています… 閉じずにお待ちください。</p>
                )}
                {submitState === 'saved' && (
                  <p className="text-emerald-700 text-xs mb-4">回答の送信が完了しました。このまま閉じて構いません。</p>
                )}
                {submitState === 'failed' && (
                  <div className="mb-4 flex flex-col items-center gap-2">
                    <p className="text-red-700 text-xs">回答の送信に失敗しました。通信環境をご確認のうえ再送信してください。</p>
                    <button
                      onClick={() => persistResults()}
                      className="inline-flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                    >
                      回答を再送信する
                    </button>
                  </div>
                )}

                <div className="flex flex-col gap-2 items-center">
                  {interviewType === 'usability' ? (
                    // ユーザビリティ: 画面＋顔＋音声を合成した1ファイル
                    screenRecordingDownloadUrl ? (
                      <a
                        href={screenRecordingDownloadUrl}
                        download={`recording-${sessionId.slice(0, 8)}.webm`}
                        className="inline-flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                      >
                        <Monitor className="w-3.5 h-3.5" strokeWidth={2} />
                        録画（画面＋顔＋音声）をダウンロード
                      </a>
                    ) : (
                      <p className="text-gray-500 text-xs">このページを閉じていただいて構いません。</p>
                    )
                  ) : recordingDownloadUrl ? (
                    <a
                      href={recordingDownloadUrl}
                      download={`interview-${sessionId.slice(0, 8)}.webm`}
                      className="inline-flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                    >
                      <Video className="w-3.5 h-3.5" strokeWidth={2} />
                      録画をダウンロード
                    </a>
                  ) : (
                    <p className="text-gray-500 text-xs">このページを閉じていただいて構いません。</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 右：質問パネル + 会話ログ（スクロール独立） */}
        <div className="w-full md:w-96 flex-1 md:flex-none md:flex-shrink-0 border-t md:border-t-0 md:border-l border-gray-200 bg-gray-50 flex flex-col overflow-hidden min-h-0">
          {/* タスクリスト (usability) */}
          {interviewType === 'usability' && tasks && tasks.length > 0 && (phase === 'waiting' || phase === 'task' || phase === 'interview' || phase === 'thinking' || phase === 'intro') && (
            <div className="p-4 border-b border-gray-200 flex-shrink-0 bg-white">
              <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-2 font-medium">タスクリスト</div>
              <div className="space-y-1">
                {tasks.map((task, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => gotoTask(i)}
                    aria-current={currentTaskIndex === i}
                    className={`w-full text-left flex gap-2 items-start cursor-pointer rounded-md px-2 py-1.5 text-xs transition-colors ${
                      currentTaskIndex === i ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`}
                  >
                    <span className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center text-[9px] font-semibold shrink-0 ${
                      currentTaskIndex === i ? 'bg-white text-gray-900' : 'bg-gray-200 text-gray-500'
                    }`}>{i + 1}</span>
                    <span className="leading-snug">{task.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 画面共有ボタン (prototype モードのみ) */}
          {interviewType === 'usability' && usabilityMode === 'prototype' && (phase === 'waiting' || phase === 'task' || phase === 'interview' || phase === 'thinking' || phase === 'intro') && (
            <div className="p-3 border-b border-gray-200 flex-shrink-0 bg-white">
              {!screenSharing ? (
                <button
                  onClick={startScreenShare}
                  className="w-full inline-flex items-center justify-center gap-1.5 bg-white hover:bg-gray-50 border border-gray-300 hover:border-gray-900 text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-xs font-medium transition-colors"
                >
                  <Monitor className="w-3.5 h-3.5" strokeWidth={2} />
                  録画を開始（このタブを共有）
                </button>
              ) : (
                <div className="flex items-center gap-2 text-xs text-emerald-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  録画中
                </div>
              )}
              {screenShareError && (
                <p className="inline-flex items-center gap-1 text-xs text-red-600 mt-1">
                  <AlertCircle className="w-3 h-3" strokeWidth={2} />
                  {screenShareError}
                </p>
              )}
            </div>
          )}

          {(phase === 'interview' || phase === 'thinking') && (
            <div className="p-4 border-b border-gray-200 flex-shrink-0 bg-white">
              <div className="flex items-center justify-between text-[10px] text-gray-500 mb-2 uppercase tracking-wide font-medium">
                <span>{isFollowUp ? `質問 ${currentQuestionIndex + 1}（深掘り中）` : `質問 ${currentQuestionIndex + 1} / ${questions.length}`}</span>
                <span className="flex items-center gap-1.5">
                  {isFollowUp && <span className="bg-amber-50 border border-amber-200 text-amber-700 px-1.5 py-0.5 rounded text-[9px]">AI 深掘り</span>}
                  {currentQ?.type !== 'open' && (
                    <span className="bg-blue-50 border border-blue-200 text-blue-700 px-1.5 py-0.5 rounded text-[9px]">
                      {currentQ?.type === 'rating' ? '5段階評価' : 'NPS'}
                    </span>
                  )}
                </span>
              </div>
              <div className="h-1 bg-gray-100 rounded-full mb-3 overflow-hidden">
                <div className="h-full bg-gray-900 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
              <p className={`text-sm font-medium leading-relaxed ${isFollowUp ? 'text-amber-700' : 'text-gray-900'}`}>
                {displayedQuestion || currentQ?.text}
              </p>
              {aiThinking && (
                <div className="mt-3 flex items-center gap-2 text-xs text-amber-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                  <span>AI が次の質問を考えています</span>
                </div>
              )}
            </div>
          )}

          {/* 感情モニター（グラフ）は参加者に見せない。理由は映像オーバーレイ側のコメント参照 */}

          {liveText && (
            <div className="p-3 border-b border-gray-200 bg-emerald-50/50 flex-shrink-0">
              <div className="text-[10px] text-emerald-700 mb-1 font-medium uppercase tracking-wide">音声認識中</div>
              <p className="text-sm text-gray-900">{liveText}</p>
            </div>
          )}

          {phase === 'interview' && !isSpeaking && !aiThinking && currentQ?.type === 'open' && (
            <div className="p-3 border-b border-gray-200 space-y-2 flex-shrink-0 bg-white">
              {isListening && (
                <div className="flex items-center gap-2 text-[10px] text-emerald-700 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  音声認識中
                </div>
              )}
              {!speechSupported && (
                <p className="text-[10px] text-amber-700">音声認識不可 — テキストで入力してください</p>
              )}
              <div className="flex gap-2">
                <input
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitTextAnswer() } }}
                  placeholder={speechSupported ? 'テキストでも入力できます' : '回答を入力...'}
                  className="flex-1 bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 rounded-md px-2.5 py-1.5 text-xs text-gray-900 placeholder-gray-500 focus:outline-none"
                />
                <button
                  onClick={submitTextAnswer}
                  disabled={!textInput.trim()}
                  className="inline-flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-30 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
                >
                  <Send className="w-3 h-3" strokeWidth={2} />
                  送信
                </button>
              </div>
              <button onClick={manualNext}
                className="w-full inline-flex items-center justify-center gap-1 border border-gray-300 hover:border-gray-400 py-1.5 rounded-md text-xs text-gray-600 hover:text-gray-900 transition-colors">
                回答を終了して次へ
                <ArrowRight className="w-3 h-3" strokeWidth={2} />
              </button>
            </div>
          )}

          {/* 会話ログ（ここだけスクロール） */}
          <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
            <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-3 font-medium">会話ログ</div>
            <div className="space-y-2">
              {transcript.map((t, i) => (
                <div key={i} className={`flex gap-2 ${t.speaker === 'Interviewer' ? '' : 'flex-row-reverse'}`}>
                  <div className={`text-xs px-3 py-2 rounded-lg max-w-[85%] leading-relaxed ${
                    t.speaker === 'Interviewer' ? 'bg-white border border-gray-200 text-gray-900' : 'bg-gray-900 text-white'
                  }`}>
                    <div className={`text-[9px] mb-1 uppercase tracking-wide font-medium ${
                      t.speaker === 'Interviewer' ? 'text-gray-400' : 'text-gray-400'
                    }`}>
                      {t.speaker === 'Interviewer' ? 'AI インタビュアー' : '参加者'}
                    </div>
                    {t.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Feature 5: 5段階評価コンポーネント
function RatingQuestion({ question, onSubmit }: { question: string; onSubmit: (v: number) => void }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const labels = ['全く思わない', 'あまり思わない', '普通', 'そう思う', '非常にそう思う']
  return (
    <div className="text-center max-w-sm w-full">
      <p className="text-sm text-gray-700 mb-5 leading-relaxed">{question}</p>
      <div className="flex gap-2.5 justify-center mb-3">
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            onMouseEnter={() => setHovered(v)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onSubmit(v)}
            className={`w-11 h-11 rounded-md font-semibold text-base transition-all border ${
              (hovered ?? 0) >= v
                ? 'bg-gray-900 text-white border-gray-900 scale-110'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500 h-4">
        {hovered ? labels[hovered - 1] : ''}
      </p>
    </div>
  )
}

// Feature 5: NPS（0〜10）コンポーネント
function NpsQuestion({ question, onSubmit }: { question: string; onSubmit: (v: number) => void }) {
  const [hovered, setHovered] = useState<number | null>(null)
  return (
    <div className="text-center max-w-lg w-full">
      <p className="text-sm text-gray-700 mb-5 leading-relaxed">{question}</p>
      <div className="flex gap-1 justify-center mb-2.5 flex-wrap">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => {
          const color = v <= 6 ? 'border-red-200 text-red-700 hover:bg-red-50'
            : v <= 8 ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
            : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
          return (
            <button
              key={v}
              onMouseEnter={() => setHovered(v)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSubmit(v)}
              className={`w-9 h-9 rounded-md font-medium text-sm transition-all bg-white border ${color} ${hovered === v ? 'scale-110' : ''}`}
            >
              {v}
            </button>
          )
        })}
      </div>
      <div className="flex justify-between text-xs text-gray-500 max-w-sm mx-auto">
        <span>全く勧めない</span>
        <span>非常に勧めたい</span>
      </div>
    </div>
  )
}
