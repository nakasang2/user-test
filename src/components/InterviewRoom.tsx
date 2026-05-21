'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useEmotionDetection, EmotionSnapshot } from '@/hooks/useEmotionDetection'
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis } from 'recharts'

interface Question {
  text: string
  type: 'open' | 'rating' | 'nps'
}

interface Props {
  sessionId: string
  roomName: string
  dailyRoomUrl: string
  questions: Question[]
  interviewTitle: string
  participantName?: string
}

interface TranscriptEntry {
  speaker: string
  text: string
  start: number
  end?: number
}

// Feature 6: 案内フェーズを追加
type Phase = 'guide' | 'waiting' | 'intro' | 'interview' | 'thinking' | 'ending' | 'done'

export default function InterviewRoom({
  sessionId,
  questions,
  interviewTitle,
  participantName,
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
    }
  }, [lastEmotion])

  const [phase, setPhase] = useState<Phase>('guide') // Feature 6: 初期フェーズを guide に
  const [displayedQuestion, setDisplayedQuestion] = useState('')
  const [isFollowUp, setIsFollowUp] = useState(false)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [liveText, setLiveText] = useState('')
  const [cameraError, setCameraError] = useState(false)
  const [aiThinking, setAiThinking] = useState(false)
  const [ratingValue, setRatingValue] = useState<number | null>(null) // Feature 5: 評価質問用
  const [textInput, setTextInput] = useState('')
  // null = チェック前（初回レンダリング）、true/false = チェック済み
  const [speechSupported, setSpeechSupported] = useState<boolean | null>(null)
  const [textOnlyMode, setTextOnlyMode] = useState(false) // 非対応でも続行する場合
  const [isListening, setIsListening] = useState(false)
  // テキスト入力フォールバック用：listenForAnswer のコールバックを保持
  const onAnswerCallbackRef = useRef<((answer: string) => void) | null>(null)

  // 音声認識サポート確認（マウント時）
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition // eslint-disable-line @typescript-eslint/no-explicit-any
      setSpeechSupported(!!SR)
    }
  }, [])

  // ── TTS ──────────────────────────────────────────────
  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (typeof window === 'undefined') return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'ja-JP'
    utterance.rate = 0.9
    setIsSpeaking(true)
    utterance.onend = () => {
      setIsSpeaking(false)
      onEnd?.()
    }
    window.speechSynthesis.speak(utterance)
    const entry: TranscriptEntry = {
      speaker: 'Interviewer',
      text,
      start: (Date.now() - startTimeRef.current) / 1000,
    }
    transcriptRef.current = [...transcriptRef.current, entry]
    setTranscript([...transcriptRef.current])
  }, [])

  // ── カメラ初期化 ─────────────────────────────────────
  useEffect(() => {
    async function initCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          // ビデオが再生可能になったら感情検出を開始できる状態にする
          videoRef.current.addEventListener('loadeddata', () => setCameraReady(true), { once: true })
        }
      } catch {
        setCameraError(true)
      }
    }
    initCamera()
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      window.speechSynthesis?.cancel()
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      stopDetection()
      if (mediaRecorderRef.current?.state !== 'inactive') {
        mediaRecorderRef.current?.stop()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 感情検出はインタビュー開始時に startInterview() 内で起動する。
  // こうすることで録画の t=0 と感情タイムスタンプの t=0 が一致する。

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

    // 沈黙タイムアウト開始（30秒）
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
    }, 30000)

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

  // ── インタビュー開始 ──────────────────────────────────
  async function startInterview() {
    setPhase('intro')
    setIsRecording(true)
    // 録画と感情検出を同時に開始 → タイムスタンプが一致する
    startMediaRecorder()
    if (videoRef.current) startDetection(videoRef.current)
    await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })
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
    speechRef.current?.stop()
    setLiveText('')
    moveToNextPlannedQuestion()
  }

  // ── インタビュー終了 ──────────────────────────────────
  async function endInterview() {
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
    // 録音停止 → ブラウザダウンロード + サーバーアップロード（非同期）
    const recordingBlob = await stopMediaRecorder()
    if (recordingBlob.size > 0) {
      // 1. ブラウザ自動ダウンロード
      const url = URL.createObjectURL(recordingBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `interview-${sessionId.slice(0, 8)}.webm`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      // 2. サーバーへアップロード（バックグラウンド）
      const formData = new FormData()
      formData.append('recording', recordingBlob, `${sessionId}.webm`)
      fetch(`/api/sessions/${sessionId}/recording`, {
        method: 'POST',
        body: formData,
      }).catch(console.error)
    }

    await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    })
    const fullText = transcriptRef.current.map((t) => `[${t.speaker}]: ${t.text}`).join('\n')
    const segments = transcriptRef.current.map((t) => ({
      speaker: t.speaker, text: t.text, start: t.start, end: t.end ?? t.start + 5,
    }))
    await fetch(`/api/sessions/${sessionId}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: fullText, segments, emotions: getSnapshots() }),
    })
  }

  const progress = ((currentQuestionIndex + 1) / questions.length) * 100
  const currentQ = questions[currentQuestionIndex]

  // ── ブラウザチェック画面 ──────────────────────────────
  if (speechSupported === false && !textOnlyMode) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-8">
        <div className="max-w-md w-full bg-gray-900 border border-yellow-700/50 rounded-2xl p-8 text-center">
          <div className="text-5xl mb-5">🌐</div>
          <h1 className="text-xl font-bold text-yellow-300 mb-2">推奨ブラウザでアクセスしてください</h1>
          <p className="text-gray-400 text-sm mb-6 leading-relaxed">
            このインタビューは音声認識を使用します。<br />
            現在のブラウザ（Brave など）では音声認識がブロックされているため、
            <span className="text-white font-medium"> Google Chrome または Microsoft Edge </span>
            で開いてください。
          </p>

          {/* URL コピーボタン */}
          <div className="bg-gray-800 rounded-xl p-4 mb-6">
            <p className="text-xs text-gray-500 mb-2">このページの URL を Chrome / Edge で開く</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={typeof window !== 'undefined' ? window.location.href : ''}
                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-xs text-gray-300 focus:outline-none"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href)
                  alert('URLをコピーしました')
                }}
                className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap"
              >
                URLをコピー
              </button>
            </div>
          </div>

          <div className="border-t border-gray-800 pt-5">
            <p className="text-xs text-gray-600 mb-3">または、テキスト入力のみで続けることもできます</p>
            <button
              onClick={() => setTextOnlyMode(true)}
              className="text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-5 py-2 rounded-lg transition-colors"
            >
              テキスト入力で続ける →
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
      {/* ヘッダー */}
      <div className="border-b border-gray-800 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div>
          <span className="text-lg font-bold text-indigo-400">UserVoice</span>
          <span className="text-gray-500 mx-2">/</span>
          <span className="text-gray-300 text-sm">{interviewTitle}</span>
        </div>
        {isRecording && (
          <span className="flex items-center gap-2 text-red-400 text-sm">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            録音中
          </span>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 左：カメラ（左カラムいっぱいに表示、絶対配置で高さ変動なし） */}
        <div className="flex-1 relative overflow-hidden bg-gray-900">

          {/* カメラ映像：左カラム全体を覆う */}
          {cameraError ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-gray-500 text-sm">カメラが利用できません</span>
            </div>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
            />
          )}

          {/* 感情検出ステータス（右上オーバーレイ） */}
          {emotionStatus === 'loading' && (
            <div className="absolute top-4 right-4 bg-black/60 text-gray-400 text-[10px] px-2 py-1 rounded-full">
              感情検出準備中...
            </div>
          )}
          {emotionStatus === 'ready' && lastEmotion && (
            <div className="absolute top-4 right-4 bg-black/70 text-[10px] px-2 py-1 rounded-full text-green-300 font-medium">
              {getDominantEmotionLabel(lastEmotion)}
            </div>
          )}
          {emotionStatus === 'error' && (
            <div className="absolute top-4 right-4 bg-black/60 text-red-400 text-[10px] px-2 py-1 rounded-full">
              検出エラー
            </div>
          )}

          {/* AI ステータスバッジ（左下オーバーレイ） */}
          {isSpeaking && (
            <div className="absolute bottom-4 left-4 bg-indigo-600/90 text-xs px-3 py-1.5 rounded-full animate-pulse">
              AI 話中...
            </div>
          )}
          {aiThinking && (
            <div className="absolute bottom-4 left-4 bg-amber-600/90 text-xs px-3 py-1.5 rounded-full animate-pulse">
              AI 考え中...
            </div>
          )}

          {/* 案内フェーズ（オーバーレイ） */}
          {phase === 'guide' && (
            <div className="absolute inset-0 bg-black/75 flex items-center justify-center p-8">
              <div className="text-center max-w-lg w-full">
                <div className="text-4xl mb-4">🎙️</div>
                <h1 className="text-2xl font-bold mb-3">{interviewTitle}</h1>
                <div className="bg-gray-900/80 border border-gray-700 rounded-xl p-5 text-left mb-6 space-y-3">
                  <p className="text-sm text-gray-300 font-medium">インタビューの流れ</p>
                  <ul className="space-y-2 text-sm text-gray-400">
                    <li className="flex gap-2"><span className="text-indigo-400 flex-shrink-0">①</span>カメラ・マイクを許可してください</li>
                    <li className="flex gap-2"><span className="text-indigo-400 flex-shrink-0">②</span>AI が質問を音声で読み上げます（{questions.length} 問 + 深掘り）</li>
                    <li className="flex gap-2"><span className="text-indigo-400 flex-shrink-0">③</span>マイクに向かって自由に話してください</li>
                    <li className="flex gap-2"><span className="text-indigo-400 flex-shrink-0">④</span>回答が終わったら AI が自動で次の質問に進みます</li>
                  </ul>
                  <div className="pt-1 border-t border-gray-700 text-xs text-gray-500 space-y-1">
                    <p>・インタビューは約 10〜20 分です</p>
                    <p>・静かな場所で、イヤホンなしで参加することをお勧めします</p>
                    <p>・回答はすべて録音・分析されます</p>
                  </div>
                </div>
                <button
                  onClick={() => setPhase('waiting')}
                  className="bg-indigo-600 hover:bg-indigo-500 px-8 py-3 rounded-xl font-semibold text-lg transition-colors"
                >
                  準備ができました
                </button>
              </div>
            </div>
          )}

          {/* 待機フェーズ（オーバーレイ） */}
          {phase === 'waiting' && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-8">
              <div className="text-center max-w-md">
                <p className="text-gray-300 mb-4 text-sm">カメラ・マイクが有効になったら開始してください</p>
                <button
                  onClick={startInterview}
                  disabled={!cameraReady || emotionStatus === 'loading'}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-wait px-8 py-3 rounded-xl font-semibold text-lg transition-colors"
                >
                  {emotionStatus === 'loading' ? '感情モデル準備中...' : 'インタビューを開始する'}
                </button>
              </div>
            </div>
          )}

          {/* 評価質問（オーバーレイ） */}
          {phase === 'interview' && !isSpeaking && currentQ?.type === 'rating' && (
            <div className="absolute inset-0 bg-black/70 flex items-center justify-center p-8">
              <RatingQuestion
                question={currentQ.text}
                onSubmit={(v) => submitRating(v, `${v} / 5`)}
              />
            </div>
          )}
          {phase === 'interview' && !isSpeaking && currentQ?.type === 'nps' && (
            <div className="absolute inset-0 bg-black/70 flex items-center justify-center p-8">
              <NpsQuestion
                question={currentQ.text}
                onSubmit={(v) => submitRating(v, `${v} / 10`)}
              />
            </div>
          )}

          {/* 完了画面（オーバーレイ）— ダッシュボードボタンなし */}
          {phase === 'done' && (
            <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
              <div className="text-center max-w-md px-8">
                <div className="text-6xl mb-6">✅</div>
                <h2 className="text-2xl font-bold mb-3">インタビュー完了</h2>
                <p className="text-gray-300 mb-2">ご回答いただきありがとうございました。</p>
                <p className="text-gray-500 text-sm">このページを閉じていただいて構いません。</p>
              </div>
            </div>
          )}
        </div>

        {/* 右：質問パネル + 会話ログ（スクロール独立） */}
        <div className="w-96 border-l border-gray-800 flex flex-col overflow-hidden">
          {(phase === 'interview' || phase === 'thinking') && (
            <div className="p-4 border-b border-gray-800 flex-shrink-0">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                <span>{isFollowUp ? `質問 ${currentQuestionIndex + 1}（深掘り中）` : `質問 ${currentQuestionIndex + 1} / ${questions.length}`}</span>
                <span className="flex items-center gap-1.5">
                  {isFollowUp && <span className="bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full text-[10px]">AI 深掘り</span>}
                  {currentQ?.type !== 'open' && (
                    <span className="bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full text-[10px]">
                      {currentQ?.type === 'rating' ? '5段階評価' : 'NPS'}
                    </span>
                  )}
                </span>
              </div>
              <div className="h-1 bg-gray-800 rounded-full mb-3">
                <div className="h-1 bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
              <p className={`text-sm font-medium leading-relaxed ${isFollowUp ? 'text-amber-200' : 'text-white'}`}>
                {displayedQuestion || currentQ?.text}
              </p>
              {aiThinking && (
                <div className="mt-3 flex items-center gap-2 text-xs text-amber-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  <span>AI が次の質問を考えています...</span>
                </div>
              )}
            </div>
          )}

          {/* リアルタイム感情モニター */}
          {(phase === 'interview' || phase === 'thinking' || phase === 'ending') && emotionStatus === 'ready' && (
            <div className="border-b border-gray-800 p-3 flex-shrink-0">
              <div className="text-[10px] text-gray-600 uppercase tracking-wide mb-2">感情モニター</div>
              <RealtimeEmotionGraph history={emotionHistory} />
            </div>
          )}

          {liveText && (
            <div className="p-3 border-b border-gray-800 bg-gray-900/50 flex-shrink-0">
              <div className="text-[10px] text-gray-500 mb-1">音声認識中...</div>
              <p className="text-sm text-gray-300">{liveText}</p>
            </div>
          )}

          {phase === 'interview' && !isSpeaking && !aiThinking && currentQ?.type === 'open' && (
            <div className="p-3 border-b border-gray-800 space-y-2 flex-shrink-0">
              {isListening && (
                <div className="flex items-center gap-2 text-[10px] text-green-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  音声認識中...
                </div>
              )}
              {!speechSupported && (
                <p className="text-[10px] text-yellow-500">音声認識不可 — テキストで入力してください</p>
              )}
              <div className="flex gap-2">
                <input
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitTextAnswer() } }}
                  placeholder={speechSupported ? 'テキストでも入力できます' : '回答を入力...'}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={submitTextAnswer}
                  disabled={!textInput.trim()}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                >
                  送信
                </button>
              </div>
              <button onClick={manualNext}
                className="w-full border border-gray-700 hover:border-indigo-500 py-1.5 rounded-lg text-xs text-gray-500 hover:text-indigo-400 transition-colors">
                回答を終了して次へ →
              </button>
            </div>
          )}

          {/* 会話ログ（ここだけスクロール） */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="text-xs text-gray-600 uppercase tracking-wide mb-3">会話ログ</div>
            <div className="space-y-3">
              {transcript.map((t, i) => (
                <div key={i} className={`flex gap-2 ${t.speaker === 'Interviewer' ? '' : 'flex-row-reverse'}`}>
                  <div className={`text-xs px-3 py-2 rounded-xl max-w-[85%] leading-relaxed ${
                    t.speaker === 'Interviewer' ? 'bg-indigo-900 text-indigo-100' : 'bg-gray-800 text-gray-100'
                  }`}>
                    <div className="text-[10px] opacity-60 mb-1">
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
            { label: '喜び',  color: '#34d399' },
            { label: '中立',  color: '#9ca3af' },
            { label: '悲しみ', color: '#60a5fa' },
            { label: '驚き',  color: '#fb923c' },
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
                <span className="text-[9px] text-gray-600 w-7 text-right leading-none">{label}</span>
                <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                  />
                </div>
                <span className="text-[9px] text-gray-600 w-5 text-right leading-none">{pct}%</span>
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
    happy: '😊 喜び',
    sad: '😢 悲しみ',
    angry: '😠 怒り',
    fearful: '😨 恐怖',
    disgusted: '🤢 嫌悪',
    surprised: '😲 驚き',
    neutral: '😐 中立',
  }
  return labels[dominant]
}

// Feature 5: 5段階評価コンポーネント
function RatingQuestion({ question, onSubmit }: { question: string; onSubmit: (v: number) => void }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const labels = ['全く思わない', 'あまり思わない', '普通', 'そう思う', '非常にそう思う']
  return (
    <div className="text-center max-w-sm w-full">
      <p className="text-sm text-gray-400 mb-4">{question}</p>
      <div className="flex gap-3 justify-center mb-2">
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            onMouseEnter={() => setHovered(v)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onSubmit(v)}
            className={`w-12 h-12 rounded-xl font-bold text-lg transition-all ${
              (hovered ?? 0) >= v
                ? 'bg-indigo-500 text-white scale-110'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-600 h-4">
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
      <p className="text-sm text-gray-400 mb-4">{question}</p>
      <div className="flex gap-1.5 justify-center mb-2 flex-wrap">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => {
          const color = v <= 6 ? 'bg-red-900 text-red-300 hover:bg-red-700'
            : v <= 8 ? 'bg-yellow-900 text-yellow-300 hover:bg-yellow-700'
            : 'bg-green-900 text-green-300 hover:bg-green-700'
          return (
            <button
              key={v}
              onMouseEnter={() => setHovered(v)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSubmit(v)}
              className={`w-10 h-10 rounded-lg font-medium text-sm transition-all ${color} ${hovered === v ? 'scale-110' : ''}`}
            >
              {v}
            </button>
          )
        })}
      </div>
      <div className="flex justify-between text-xs text-gray-600 max-w-sm mx-auto">
        <span>全く勧めない</span>
        <span>非常に勧めたい</span>
      </div>
    </div>
  )
}
