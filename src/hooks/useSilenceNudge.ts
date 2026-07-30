'use client'

import { useEffect, useRef } from 'react'
import { isSpeech, nextFrame, shouldNudge } from '@/lib/think-aloud'

/**
 * 思考発話（think-aloud）を促すための沈黙検知。
 *
 * ユーザビリティテストでは「考えていることを声に出してもらう」ことで、
 * 迷った理由・期待とのズレが分かる。ところが参加者は操作に集中すると黙り込む。
 * モデレーターは黙り込んだ人にだけ「いま何を考えていますか？」と声をかけるので、
 * それをマイクの音量から再現する。
 *
 * 音声認識ではなく音量で判定するのは、
 *   - 認識は背面タブで止められることがある（service モードのメイン画面は背面になる）
 *   - 何を話したかは要らない。「話しているか」だけで足りる
 * ため。判定は控えめ（しきい値をやや高く）にしてある。話している人に
 * かぶせて促すのが一番うるさいので、遅れて促すほうを選ぶ。
 */

export function useSilenceNudge({
  stream,
  active,
  silenceSec = 20,
  repeatSec = 45,
  maxNudges = 2,
  resetKey,
  onNudge,
}: {
  /** マイクを含むストリーム。取得前は null */
  stream: MediaStream | null
  /** 検知する場面か（タスク中・準備完了後など呼び出し側で判断する） */
  active: boolean
  /** 最初の声かけまでの沈黙秒数 */
  silenceSec?: number
  /** 2回目以降に必要な追加の沈黙秒数（連続で急かさないための間隔も兼ねる） */
  repeatSec?: number
  /** 1タスクあたりの上限。促しすぎると参加者を追い詰めるので少なく保つ */
  maxNudges?: number
  /** これが変わったら回数をリセットする（タスク番号を渡す） */
  resetKey?: unknown
  onNudge: () => void
}) {
  const lastSpeechRef = useRef(0)
  const nudgeCountRef = useRef(0)
  // コールバックの識別子が変わるたびに AudioContext を作り直さないよう ref で保持する
  const onNudgeRef = useRef(onNudge)
  useEffect(() => { onNudgeRef.current = onNudge }, [onNudge])

  // タスクが変わったら回数と計測を初期化する
  useEffect(() => {
    nudgeCountRef.current = 0
    lastSpeechRef.current = Date.now()
  }, [resetKey])

  useEffect(() => {
    if (!stream || !active) return
    if (stream.getAudioTracks().length === 0) return
    const AudioCtx = typeof window !== 'undefined'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (window.AudioContext ?? (window as any).webkitAudioContext)
      : undefined
    if (!AudioCtx) return

    // 生成が失敗しても促し（補助機能）のために画面全体を落とさない。
    // このリポジトリには error.tsx が無く、ここで throw するとルートまで伝播して
    // 実施中の録画・回答・タスク結果ごと失われる。
    let ctx: AudioContext | undefined
    let source: MediaStreamAudioSourceNode
    let analyser: AnalyserNode
    try {
      ctx = new AudioCtx()
      // 小窓（Document PiP の iframe）ではユーザー操作前の AudioContext が
      // suspended で始まる。そのままだと無音が返り続け、黙っていない人にも
      // 促してしまうため、resume して running のときだけ判定する。
      void ctx.resume().catch(() => {})
      source = ctx.createMediaStreamSource(stream)
      analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
    } catch (err) {
      console.warn('[UserVoice] 沈黙検知を開始できませんでした（思考発話の促しは無効）:', err)
      // 生成済みの AudioContext を閉じる。読み上げ・促しのたびに active が
      // 切り替わって張り直されるので、閉じ忘れると文書あたりの上限に達し、
      // やがて生成自体が失敗して促しが黙って止まる
      void ctx?.close().catch(() => {})
      return
    }
    const buf = new Float32Array(analyser.fftSize)
    lastSpeechRef.current = Date.now()
    // 直前のフレームが大きかったか。クリック音・キー入力の一瞬のピークで
    // 沈黙の計測をリセットしないよう、200ms 離れた2回の観測がどちらも
    // しきい値を超えたときだけ発話とみなす（1回の観測で判定すると、
    // 黙っている参加者が操作音だけで「話している」ことになり一度も促されない）。
    // 観測は1回あたり約21ms 分なので「400ms 鳴り続けている」判定ではない。
    let prevLoud = false

    const timer = setInterval(() => {
      if (ctx.state !== 'running') return   // 測れていないので判定しない
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const rms = Math.sqrt(sum / buf.length)
      const now = Date.now()
      const frame = nextFrame(prevLoud, isSpeech(rms))
      prevLoud = frame.prevLoud
      if (frame.sawSpeech) lastSpeechRef.current = now
      if (!frame.canNudge) return
      const state = { lastSpeechAt: lastSpeechRef.current, nudgeCount: nudgeCountRef.current }
      if (!shouldNudge(now, state, { silenceSec, repeatSec, maxNudges })) return
      nudgeCountRef.current += 1
      lastSpeechRef.current = now   // 促した直後から測り直す
      onNudgeRef.current()
    }, 200)

    return () => {
      clearInterval(timer)
      try { source.disconnect() } catch { /* already disconnected */ }
      void ctx.close().catch(() => {})
    }
  }, [stream, active, silenceSec, repeatSec, maxNudges])
}
