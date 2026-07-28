'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { nowMs, elapsedSec } from '@/lib/elapsed'

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

// マウント直後に必ずモデルのロードを始めるため、初期状態は 'loading'
// （'idle' は使わないので型からも外す）
type DetectionStatus = 'loading' | 'ready' | 'error'
// 顔フレーミング: null=判定前 / 'ok'=正常 / 'no_face'=写っていない / 'cut_off'=見切れ
export type FaceFraming = 'ok' | 'no_face' | 'cut_off' | null

export function useEmotionDetection(intervalMs = 5000) {
  const [status, setStatus] = useState<DetectionStatus>('loading')
  const [lastEmotion, setLastEmotion] = useState<EmotionSnapshot | null>(null)
  const [faceStatus, setFaceStatus] = useState<FaceFraming>(null)
  const snapshotsRef = useRef<EmotionSnapshot[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(nowMs())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const faceApiRef = useRef<any>(null)

  // モデルを非同期ロード
  useEffect(() => {
    let cancelled = false

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
    startTimeRef.current = nowMs()

    intervalRef.current = setInterval(async () => {
      if (!faceApiRef.current) return
      try {
        const faceapi = faceApiRef.current
        const detection = await faceapi
          .detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.3 }))
          .withFaceExpressions()

        if (!detection) { setFaceStatus('no_face'); return } // 顔が映っていない

        // 顔フレーミング判定: box が映像端（±1.5%、最低6px）に接していたら見切れ
        const { x, y, width, height } = detection.detection.box
        const vw = videoEl.videoWidth
        const vh = videoEl.videoHeight
        if (vw && vh) {
          const mx = Math.max(6, vw * 0.015)
          const my = Math.max(6, vh * 0.015)
          const cut = x <= mx || y <= my || (x + width) >= (vw - mx) || (y + height) >= (vh - my)
          setFaceStatus(cut ? 'cut_off' : 'ok')
        }

        const expr = detection.expressions
        const snapshot: EmotionSnapshot = {
          timestamp: elapsedSec(startTimeRef.current),
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
    setFaceStatus(null) // 停止後に古い見切れ警告が残らないようリセット
  }, [])

  // スナップショット一覧を返す
  const getSnapshots = useCallback(() => snapshotsRef.current, [])

  return { status, lastEmotion, faceStatus, startDetection, stopDetection, getSnapshots }
}
