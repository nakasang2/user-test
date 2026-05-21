'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

export interface EmotionSnapshot {
  timestamp: number
  happy: number
  sad: number
  angry: number
  fearful: number
  disgusted: number
  surprised: number
  neutral: number
}

type DetectionStatus = 'idle' | 'loading' | 'ready' | 'error'

export function useEmotionDetection(intervalMs = 5000) {
  const [status, setStatus] = useState<DetectionStatus>('idle')
  const [lastEmotion, setLastEmotion] = useState<EmotionSnapshot | null>(null)
  const snapshotsRef = useRef<EmotionSnapshot[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(Date.now())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const faceApiRef = useRef<any>(null)

  // モデルを非同期ロード
  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    async function loadModels() {
      try {
        // SSR 対策：ブラウザ側でのみロード
        if (typeof window === 'undefined') return

        const faceapi = await import('@vladmandic/face-api')
        faceApiRef.current = faceapi

        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
          faceapi.nets.faceExpressionNet.loadFromUri('/models'),
        ])

        if (!cancelled) setStatus('ready')
      } catch (err) {
        console.error('[EmotionDetection] モデルロード失敗:', err)
        if (!cancelled) setStatus('error')
      }
    }

    loadModels()
    return () => { cancelled = true }
  }, [])

  // 検出開始
  const startDetection = useCallback((videoEl: HTMLVideoElement) => {
    if (status !== 'ready' || !faceApiRef.current) return
    startTimeRef.current = Date.now()

    intervalRef.current = setInterval(async () => {
      if (!faceApiRef.current) return
      try {
        const faceapi = faceApiRef.current
        const detection = await faceapi
          .detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.3 }))
          .withFaceExpressions()

        if (!detection) return // 顔が映っていない

        const expr = detection.expressions
        const snapshot: EmotionSnapshot = {
          timestamp: (Date.now() - startTimeRef.current) / 1000,
          happy: expr.happy,
          sad: expr.sad,
          angry: expr.angry,
          fearful: expr.fearful,
          disgusted: expr.disgusted,
          surprised: expr.surprised,
          neutral: expr.neutral,
        }

        snapshotsRef.current = [...snapshotsRef.current, snapshot]
        setLastEmotion(snapshot)
      } catch {
        // 検出エラーはスキップ（フレームが取れない場合など）
      }
    }, intervalMs)
  }, [status, intervalMs])

  // 検出停止
  const stopDetection = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  // スナップショット一覧を返す
  const getSnapshots = useCallback(() => snapshotsRef.current, [])

  return { status, lastEmotion, startDetection, stopDetection, getSnapshots }
}
