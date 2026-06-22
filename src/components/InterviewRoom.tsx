'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { upload } from '@vercel/blob/client'
import { track } from '@/lib/analytics'
import { useEmotionDetection, EmotionSnapshot } from '@/hooks/useEmotionDetection'
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis } from 'recharts'
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
  Copy,
} from 'lucide-react'

interface Question {
  text: string
  type: 'open' | 'rating' | 'nps'
}

interface Props {
  sessionId: string
  participantToken?: string
  roomName: string
  dailyRoomUrl: string
  questions: Question[]
  interviewTitle: string
  participantName?: string
  interviewType?: 'interview' | 'impression' | 'usability'
  usabilityMode?: 'prototype' | 'service'
  stimulusUrl?: string
  stimulusDuration?: number  // seconds (default 5)
  tasks?: { text: string; order: number }[]
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
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const speechRef = useRef<any>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startTimeRef = useRef<number>(Date.now())
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
  const { status: emotionStatus, lastEmotion, startDetection, stopDetection, getSnapshots } = useEmotionDetection(5000)
  const [cameraReady, setCameraReady] = useState(false)
  // リアルタイムグラフ用：lastEmotion が更新されるたびに履歴に追加（最大 30 件 ≈ 2.5 分）
  const [emotionHistory, setEmotionHistory] = useState<EmotionSnapshot[]>([])
  useEffect(() => {
    if (lastEmotion) {
      setEmotionHistory((prev) => [...prev, lastEmotion].slice(-30))
      // 途中離脱でも残るよう、感情スナップショットを逐次サーバー保存（失敗は無視）。
      // 最終的には submitResults→/process が全件で上書きする。
      if (participantToken) {
        fetch('/api/emotions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-participant-token': participantToken },
          body: JSON.stringify({ sessionId, ...lastEmotion }),
        }).catch(() => {})
      }
    }
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
  const [ratingValue, setRatingValue] = useState<number | null>(null) // Feature 5: 評価質問用
  const [textInput, setTextInput] = useState('')
  // null = チェック前（初回レンダリング）、true/false = チェック済み
  const [speechSupported, setSpeechSupported] = useState<boolean | null>(null)
  const [textOnlyMode, setTextOnlyMode] = useState(false) // 非対応でも続行する場合
  const [isListening, setIsListening] = useState(false)
  const [recordingDownloadUrl, setRecordingDownloadUrl] = useState<string | null>(null)
  // テキスト入力フォールバック用：listenForAnswer のコールバックを保持
  const onAnswerCallbackRef = useRef<((answer: string) => void) | null>(null)

  // usability / prototype 用：画面共有
  const screenVideoRef = useRef<HTMLVideoElement>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const [screenSharing, setScreenSharing] = useState(false)
  const [screenShareError, setScreenShareError] = useState<string | null>(null)
  const [currentTaskIndex, setCurrentTaskIndex] = useState(0)
  const [stimulusCountdown, setStimulusCountdown] = useState(0)
  const screenMediaRecorderRef = useRef<MediaRecorder | null>(null)
  const screenRecordedChunksRef = useRef<Blob[]>([])
  const [screenRecordingDownloadUrl, setScreenRecordingDownloadUrl] = useState<string | null>(null)

  // フローティングウィジェット (service モード)
  const widgetChannelRef = useRef<BroadcastChannel | null>(null)
  const [widgetBlocked, setWidgetBlocked] = useState(false)
  const serviceWinRef = useRef<Window | null>(null) // サービスタブの window 参照
  const pipWindowRef = useRef<Window | null>(null)   // Document PiP または popup の window 参照

  // 音声認識サポート確認（マウント時）
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition // eslint-disable-line @typescript-eslint/no-explicit-any
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
      start: (Date.now() - startTimeRef.current) / 1000,
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
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 感情検出はインタビュー開始時に startInterview() 内で起動する。
  // こうすることで録画の t=0 と感情タイムスタンプの t=0 が一致する。

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
      start: (Date.now() - startTimeRef.current) / 1000,
      end: (Date.now() - startTimeRef.current) / 1000,
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
    const startTime = (Date.now() - startTimeRef.current) / 1000

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
      if (finalText.trim()) {
        const entry: TranscriptEntry = {
          speaker: 'Participant',
          text: finalText.trim(),
          start: startTime,
          end: (Date.now() - startTimeRef.current) / 1000,
        }
        transcriptRef.current = [...transcriptRef.current, entry]
        setTranscript([...transcriptRef.current])
        conversationBufferRef.current += `\n参加者: ${finalText.trim()}`
        saveProgress()
        onAnswer(finalText.trim())
      }
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
      start: (Date.now() - startTimeRef.current) / 1000,
    }
    transcriptRef.current = [...transcriptRef.current, entry]
    setTranscript([...transcriptRef.current])
    conversationBufferRef.current += `\n参加者: ${answerText}`
    setRatingValue(null)
    saveProgress()

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
  function moveToNextPlannedQuestion() {
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

  // ── ユーザビリティ: サービスを新しいタブで開く ────────────
  function openServicePopup() {
    if (!stimulusUrl) return
    const win = window.open(stimulusUrl, 'uservoice-service')
    if (win) serviceWinRef.current = win
  }

  // ── タスクウィジェットを開く（Document PiP 優先 → ポップアップ fallback） ──
  // ⚠️ この関数は必ずユーザージェスチャーハンドラの中で、かつ window.open() より先に呼ぶこと
  //    （documentPictureInPicture.requestWindow() は transient user activation を要求する。
  //      window.open() が先に呼ばれるとトークンが消費されて PiP が失敗しポップアップに落ちる）
  async function openWidget() {
    const tasksEncoded = btoa(encodeURIComponent(JSON.stringify(tasks ?? [])))
    const url = `/interview/widget?session=${encodeURIComponent(sessionId)}&tasks=${tasksEncoded}&current=${currentTaskIndex}`

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docPiP = (window as any).documentPictureInPicture
    if (docPiP) {
      try {
        // Document PiP: どのタブ・ウィンドウの上にも常時浮く小窓（Chrome 116+ / Google Meet と同じ仕組み）
        const pipWindow: Window = await docPiP.requestWindow({ width: 400, height: 560 })
        pipWindow.document.body.style.cssText = 'margin:0;padding:0;overflow:hidden;background:#ffffff;'
        const iframe = pipWindow.document.createElement('iframe')
        iframe.src = url
        iframe.style.cssText = 'width:100%;height:100%;border:none;'
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
    setIsRecording(true)
    startMediaRecorder()
    if (videoRef.current) startDetection(videoRef.current)

    // service モード: ウィンドウ系は await より前に呼ぶ（ユーザージェスチャー文脈を維持）
    if (interviewType === 'usability' && usabilityMode === 'service') {
      // BroadcastChannel を先にセットアップ
      const channel = new BroadcastChannel(`uservoice-widget-${sessionId}`)
      widgetChannelRef.current = channel
      channel.onmessage = (e) => {
        if (e.data.type === 'task_complete') completeTasksAndStartInterview()
        else if (e.data.type === 'end_session') endInterview()
        else if (e.data.type === 'recording_started') setScreenSharing(true)
        else if (e.data.type === 'screen_recording_blob') {
          const blob: Blob = e.data.blob
          if (blob.size > 0) {
            const url = URL.createObjectURL(blob)
            setScreenRecordingDownloadUrl(url)
          }
        }
      }
      // ① ウィジェット（PiP or ポップアップ）を「最初に」開く
      //    ⚠️ documentPictureInPicture.requestWindow() は transient user activation が必要。
      //       window.open() より後に呼ぶとトークンが消費されて PiP が失敗するため、必ず先に呼ぶ。
      void openWidget()
      // ② サービスタブを開く（PiP の後）
      if (stimulusUrl) {
        const win = window.open(stimulusUrl, 'uservoice-service')
        if (win) serviceWinRef.current = win
      }
      // ③ サービスタブへ自動遷移
      serviceWinRef.current?.focus()
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
        startScreenShare().catch(() => {/* 録画失敗は無視して続行 */})
      }
      setPhase('task')
      return
    }

    // 印象テストの場合: stimulus フェーズを挿入
    if (interviewType === 'impression' && stimulusUrl) {
      setPhase('stimulus')
      const duration = stimulusDuration ?? 5
      setStimulusCountdown(duration)
      const countdownInterval = setInterval(() => {
        setStimulusCountdown((prev) => {
          if (prev <= 1) { clearInterval(countdownInterval); return 0 }
          return prev - 1
        })
      }, 1000)
      setTimeout(() => {
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
      }, duration * 1000)
      return
    }

    // 通常インタビュー
    setPhase('intro')
    const intro = `こんにちは${participantName ? `、${participantName}さん` : ''}。本日はインタビューにご参加いただきありがとうございます。「${interviewTitle}」についてお聞きします。`
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

  // ── インタビュー終了 ──────────────────────────────────
  async function endInterview() {
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
    // 録画停止 → ローカル DL 用 URL（フォールバック）＋ サーバーへ自動アップロード
    const recordingBlob = await stopMediaRecorder()
    if (recordingBlob.size > 0) {
      setRecordingDownloadUrl(URL.createObjectURL(recordingBlob))
      // Vercel Blob クライアント直アップロードで関数の 4.5MB ボディ制限を回避し、非公開保存する。
      // 認可は participantToken（clientPayload）でサーバー側が検証する。
      try {
        await upload(`recordings/${sessionId}.webm`, recordingBlob, {
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

    // 画面録画も保存
    const screenBlob = await stopScreenRecorder()
    if (screenBlob.size > 0) {
      const screenUrl = URL.createObjectURL(screenBlob)
      setScreenRecordingDownloadUrl(screenUrl)
    }

    await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-participant-token': participantToken ?? '' },
      body: JSON.stringify({ status: 'completed' }),
    })
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
    } catch (e) {
      console.error('結果の送信に失敗しました:', e)
      track('interview_process_failed', { sessionId })
      showNotice('回答の送信に失敗しました。通信環境をご確認ください。')
    }
  }

  // ── 画面共有開始 ──────────────────────────────────────
  async function startScreenShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      screenStreamRef.current = stream
      // For 'service' mode: show in video element
      if (usabilityMode === 'service' && screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream
      }
      // Record the screen stream
      screenRecordedChunksRef.current = []
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(
        (t) => MediaRecorder.isTypeSupported(t)
      ) ?? ''
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {})
      recorder.ondataavailable = (e) => { if (e.data.size > 0) screenRecordedChunksRef.current.push(e.data) }
      recorder.start(1000)
      screenMediaRecorderRef.current = recorder
      setScreenSharing(true)
      stream.getVideoTracks()[0].onended = () => {
        setScreenSharing(false)
        screenStreamRef.current = null
      }
    } catch {
      setScreenShareError('画面共有を開始できませんでした')
    }
  }

  // ── 画面録画停止 → Blob を返す ────────────────────────
  function stopScreenRecorder(): Promise<Blob> {
    return new Promise((resolve) => {
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

      <div className="flex-1 flex overflow-hidden">
        {/* 左：カメラ（左カラムいっぱいに表示、絶対配置で高さ変動なし） */}
        <div className="flex-1 relative overflow-hidden bg-gray-900">

          {/* カメラ映像：左カラム全体を覆う */}
          {cameraError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-100 px-6 text-center">
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
          ) : (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className={
                interviewType === 'usability' && (phase === 'task' || phase === 'interview' || phase === 'thinking' || phase === 'intro' || phase === 'waiting')
                  ? 'absolute bottom-4 right-4 w-44 h-28 object-cover scale-x-[-1] rounded-lg border border-white/20 z-20 shadow-xl'
                  : 'absolute inset-0 w-full h-full object-cover scale-x-[-1]'
              }
            />
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

          {/* 感情検出ステータス（右上オーバーレイ） */}
          {emotionStatus === 'loading' && (
            <div className="absolute top-4 right-4 bg-white/95 border border-gray-200 text-gray-600 text-[10px] px-2 py-1 rounded-md shadow-sm font-medium">
              感情検出準備中
            </div>
          )}
          {emotionStatus === 'ready' && lastEmotion && (
            <div className="absolute top-4 right-4 bg-white/95 border border-gray-200 text-[10px] px-2 py-1 rounded-md shadow-sm text-gray-900 font-medium">
              {getDominantEmotionLabel(lastEmotion)}
            </div>
          )}
          {emotionStatus === 'error' && (
            <div className="absolute top-4 right-4 bg-white/95 border border-red-200 text-red-600 text-[10px] px-2 py-1 rounded-md shadow-sm font-medium">
              検出エラー
            </div>
          )}

          {/* AI ステータスバッジ（左下オーバーレイ） */}
          {isSpeaking && (
            <div className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 bg-gray-900 text-white text-xs px-3 py-1.5 rounded-full shadow-lg">
              <Sparkles className="w-3 h-3 animate-pulse" strokeWidth={2} />
              AI 話中
            </div>
          )}
          {aiThinking && (
            <div className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 bg-amber-500 text-white text-xs px-3 py-1.5 rounded-full shadow-lg">
              <Sparkles className="w-3 h-3 animate-pulse" strokeWidth={2} />
              AI 考え中
            </div>
          )}

          {/* 案内フェーズ（オーバーレイ） */}
          {phase === 'guide' && (
            <div className="absolute inset-0 bg-gray-950/40 backdrop-blur-sm flex items-center justify-center p-8">
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
                          <li className="flex gap-2.5"><span className="text-gray-400 flex-shrink-0 font-medium">4.</span>操作が終わったら「タスク完了」を押してください。その後、簡単な質問があります</li>
                        </>
                      ) : (
                        <>
                          <li className="flex gap-2.5"><span className="text-gray-400 flex-shrink-0 font-medium">2.</span>
                            <span>「開始する」を押すと<span className="text-gray-900 font-medium">サービスが新しいタブ</span>で開き、<span className="text-gray-900 font-medium">タスク用の小窓</span>が自動表示されます（小窓はどのタブを操作していても<span className="text-gray-900 font-medium">常に最前面</span>に表示されます）</span>
                          </li>
                          <li className="flex gap-2.5"><span className="text-gray-400 flex-shrink-0 font-medium">3.</span>
                            <span>小窓の <span className="inline-flex items-center gap-1 text-red-600 font-medium"><Monitor className="w-3 h-3 inline" strokeWidth={2} />画面録画を開始する</span> を<strong className="text-gray-900">必ず押してから</strong>操作を始めてください</span>
                          </li>
                          <li className="flex gap-2.5"><span className="text-gray-400 flex-shrink-0 font-medium">4.</span>タスクに沿ってサービスを操作しながら、気づいたこと・感じたことを声に出してください（シンクアラウド）</li>
                          <li className="flex gap-2.5"><span className="text-gray-400 flex-shrink-0 font-medium">5.</span>操作が終わったら小窓の「タスク完了 → 質問へ」を押してください</li>
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
              <img
                src={stimulusUrl}
                alt="stimulus"
                className="max-w-full max-h-full object-contain"
              />
              {stimulusCountdown > 0 && (
                <div className="absolute bottom-6 right-6 w-12 h-12 rounded-full bg-gray-900 text-white flex items-center justify-center text-xl font-semibold shadow-lg">
                  {stimulusCountdown}
                </div>
              )}
            </div>
          )}

          {/* ユーザビリティテスト: タスクフェーズオーバーレイ */}
          {phase === 'task' && interviewType === 'usability' && (
            <div className="absolute inset-0 bg-gray-950/40 backdrop-blur-sm flex items-end justify-center pb-8 z-10">
              <div className="bg-white border border-gray-200 rounded-xl shadow-xl p-5 max-w-md w-full mx-4 space-y-4">
                {tasks && tasks.length > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-wide font-medium">
                      タスク {currentTaskIndex + 1} / {tasks.length}
                    </p>
                    <p className="text-sm text-gray-900 font-medium leading-relaxed">
                      {tasks[currentTaskIndex]?.text}
                    </p>
                  </div>
                )}

                {usabilityMode === 'service' ? (
                  <div className="space-y-3">
                    {screenSharing ? (
                      <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-md bg-red-50 border border-red-200 text-red-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                        画面録画中
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-md bg-gray-50 border border-gray-200 text-gray-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 flex-shrink-0" />
                        ウィジェットから画面録画を開始してください
                      </div>
                    )}
                    {widgetBlocked ? (
                      <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-800 leading-relaxed">
                        ポップアップがブロックされました。ブラウザのアドレスバー右端でポップアップを許可するか、下のボタンで操作してください。
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-emerald-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                        タスクウィジェットが別ウィンドウで起動中です
                      </div>
                    )}
                    <div className="flex gap-2">
                      {stimulusUrl && (
                        <button
                          onClick={openServicePopup}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-xs font-medium transition-colors"
                        >
                          <Globe className="w-3.5 h-3.5" strokeWidth={2} />
                          サービスを再度開く
                        </button>
                      )}
                      <button
                        onClick={openWidget}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-xs font-medium transition-colors"
                      >
                        <AppWindow className="w-3.5 h-3.5" strokeWidth={2} />
                        ウィジェットを再度開く
                      </button>
                    </div>
                    {widgetBlocked && (
                      <div className="flex gap-2 pt-2 border-t border-gray-200">
                        <button
                          onClick={completeTasksAndStartInterview}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                          タスク完了
                          <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
                          質問へ
                        </button>
                        <button
                          onClick={endInterview}
                          className="border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 px-4 py-2 rounded-md text-sm transition-colors"
                        >
                          終了
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={completeTasksAndStartInterview}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2.5 rounded-md text-sm font-medium transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                      タスク完了
                      <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
                      質問へ
                    </button>
                    <button
                      onClick={endInterview}
                      className="border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 px-4 py-2.5 rounded-md text-sm transition-colors"
                    >
                      終了
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 評価質問（オーバーレイ） */}
          {phase === 'interview' && !isSpeaking && currentQ?.type === 'rating' && (
            <div className="absolute inset-0 bg-gray-950/40 backdrop-blur-sm flex items-center justify-center p-8">
              <div className="bg-white rounded-xl border border-gray-200 shadow-xl p-8">
                <RatingQuestion
                  question={currentQ.text}
                  onSubmit={(v) => submitRating(v, `${v} / 5`)}
                />
              </div>
            </div>
          )}
          {phase === 'interview' && !isSpeaking && currentQ?.type === 'nps' && (
            <div className="absolute inset-0 bg-gray-950/40 backdrop-blur-sm flex items-center justify-center p-8">
              <div className="bg-white rounded-xl border border-gray-200 shadow-xl p-8">
                <NpsQuestion
                  question={currentQ.text}
                  onSubmit={(v) => submitRating(v, `${v} / 10`)}
                />
              </div>
            </div>
          )}

          {/* 完了画面（オーバーレイ）— ダッシュボードボタンなし */}
          {phase === 'done' && (
            <div className="absolute inset-0 bg-gray-950/40 backdrop-blur-sm flex items-center justify-center">
              <div className="text-center max-w-md px-8 bg-white rounded-2xl border border-gray-200 shadow-xl py-10">
                <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-5">
                  <CheckCircle2 className="w-7 h-7 text-emerald-600" strokeWidth={1.5} />
                </div>
                <h2 className="text-xl font-semibold tracking-tight mb-2 text-gray-900">インタビュー完了</h2>
                <p className="text-gray-600 text-sm mb-4">ご回答いただきありがとうございました。</p>
                <div className="flex flex-col gap-2 items-center">
                  {recordingDownloadUrl ? (
                    <a
                      href={recordingDownloadUrl}
                      download={`interview-${sessionId.slice(0, 8)}.webm`}
                      className="inline-flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                    >
                      <Video className="w-3.5 h-3.5" strokeWidth={2} />
                      顔録画をダウンロード
                    </a>
                  ) : (
                    <p className="text-gray-500 text-xs">このページを閉じていただいて構いません。</p>
                  )}
                  {screenRecordingDownloadUrl && (
                    <a
                      href={screenRecordingDownloadUrl}
                      download={`screen-${sessionId.slice(0, 8)}.webm`}
                      className="inline-flex items-center gap-1.5 border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 px-4 py-2 rounded-md text-sm font-medium transition-colors"
                    >
                      <Monitor className="w-3.5 h-3.5" strokeWidth={2} />
                      操作録画（顔合成）をダウンロード
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 右：質問パネル + 会話ログ（スクロール独立） */}
        <div className="w-96 border-l border-gray-200 bg-gray-50 flex flex-col overflow-hidden">
          {/* タスクリスト (usability) */}
          {interviewType === 'usability' && tasks && tasks.length > 0 && (phase === 'waiting' || phase === 'task' || phase === 'interview' || phase === 'thinking' || phase === 'intro') && (
            <div className="p-4 border-b border-gray-200 flex-shrink-0 bg-white">
              <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-2 font-medium">タスクリスト</div>
              <div className="space-y-1">
                {tasks.map((task, i) => (
                  <div
                    key={i}
                    onClick={() => setCurrentTaskIndex(i)}
                    className={`flex gap-2 items-start cursor-pointer rounded-md px-2 py-1.5 text-xs transition-colors ${
                      currentTaskIndex === i ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`}
                  >
                    <span className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center text-[9px] font-semibold shrink-0 ${
                      currentTaskIndex === i ? 'bg-white text-gray-900' : 'bg-gray-200 text-gray-500'
                    }`}>{i + 1}</span>
                    <span className="leading-snug">{task.text}</span>
                  </div>
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
                  <Mic className="w-3.5 h-3.5" strokeWidth={2} />
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

          {/* リアルタイム感情モニター */}
          {(phase === 'interview' || phase === 'thinking' || phase === 'ending') && emotionStatus === 'ready' && (
            <div className="border-b border-gray-200 p-3 flex-shrink-0 bg-white">
              <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-2 font-medium">感情モニター</div>
              <RealtimeEmotionGraph history={emotionHistory} />
            </div>
          )}

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
                  className="flex-1 bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 rounded-md px-2.5 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
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

// リアルタイム感情グラフ（折れ線 + 現在値バー）
type ChartPoint = { t: number; happy: number; neutral: number; sad: number; surprised: number }

const EMOTION_BARS = [
  { key: 'happy',     label: '喜び',  color: '#34d399' },
  { key: 'neutral',   label: '中立',  color: '#9ca3af' },
  { key: 'sad',       label: '悲しみ', color: '#60a5fa' },
  { key: 'surprised', label: '驚き',  color: '#fb923c' },
  { key: 'angry',     label: '怒り',  color: '#f87171' },
  { key: 'fearful',   label: '恐怖',  color: '#a78bfa' },
  { key: 'disgusted', label: '嫌悪',  color: '#4ade80' },
] as const

function RealtimeEmotionGraph({ history }: { history: EmotionSnapshot[] }) {
  const latest = history[history.length - 1]

  // recharts 用データ（最新 15 点）
  const chartData: ChartPoint[] = history.slice(-15).map((s, i) => ({
    t: i,
    happy:     Math.round(s.happy * 100),
    neutral:   Math.round(s.neutral * 100),
    sad:       Math.round(s.sad * 100),
    surprised: Math.round(s.surprised * 100),
  }))

  return (
    <div>
      {/* 折れ線グラフ（happy / neutral / sad / surprised） */}
      <div className="mb-2">
        {chartData.length >= 2 ? (
          <ResponsiveContainer width="100%" height={72}>
            <AreaChart data={chartData} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
              <XAxis dataKey="t" hide />
              <YAxis domain={[0, 100]} hide />
              <Area type="monotone" dataKey="happy"     stroke="#34d399" fill="#34d39918" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Area type="monotone" dataKey="neutral"   stroke="#9ca3af" fill="#9ca3af18" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Area type="monotone" dataKey="sad"       stroke="#60a5fa" fill="#60a5fa18" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Area type="monotone" dataKey="surprised" stroke="#fb923c" fill="#fb923c18" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[72px] flex items-center justify-center text-[10px] text-gray-700">
            検出待ち...
          </div>
        )}
        {/* 凡例 */}
        <div className="flex gap-3 justify-center mt-1">
          {[
            { label: '喜び',  color: '#10b981' },
            { label: '中立',  color: '#6b7280' },
            { label: '悲しみ', color: '#3b82f6' },
            { label: '驚き',  color: '#f97316' },
          ].map((e) => (
            <span key={e.label} className="flex items-center gap-1 text-[9px] text-gray-500">
              <span className="w-2 h-0.5 rounded-full inline-block" style={{ backgroundColor: e.color }} />
              {e.label}
            </span>
          ))}
        </div>
      </div>

      {/* 現在値バー（全7感情） */}
      {latest && (
        <div className="space-y-1 mt-2">
          {EMOTION_BARS.map(({ key, label, color }) => {
            const pct = Math.round((latest[key] as number) * 100)
            return (
              <div key={key} className="flex items-center gap-1.5">
                <span className="text-[9px] text-gray-500 w-7 text-right leading-none">{label}</span>
                <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                  />
                </div>
                <span className="text-[9px] text-gray-500 w-5 text-right leading-none">{pct}%</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// 感情スナップショットから最も強い感情のラベルを返す
function getDominantEmotionLabel(e: EmotionSnapshot): string {
  const keys = ['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'neutral'] as const
  const dominant = keys.reduce((a, b) => (e[a] >= e[b] ? a : b))
  const labels: Record<typeof dominant, string> = {
    happy: '喜び',
    sad: '悲しみ',
    angry: '怒り',
    fearful: '恐怖',
    disgusted: '嫌悪',
    surprised: '驚き',
    neutral: '中立',
  }
  return labels[dominant]
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
