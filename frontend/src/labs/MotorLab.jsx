import { useEffect, useRef, useState } from 'react'
import { beep, useTimer } from '../lib/useCountdown.js'

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
const TRIAL_MS = 10000
const HANDS = ['right', 'left']
const CONNECTIONS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]]

let landmarkerPromise = null
async function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision')
      const fileset = await FilesetResolver.forVisionTasks(WASM)
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: 'VIDEO', numHands: 1,
        minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
      })
      try { return await HandLandmarker.createFromOptions(fileset, opts('GPU')) }
      catch { return await HandLandmarker.createFromOptions(fileset, opts('CPU')) }
    })()
    landmarkerPromise.catch(() => { landmarkerPromise = null })
  }
  return landmarkerPromise
}

export default function MotorLab({ onSubmit }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const recRef = useRef(null)        // active recording buffer or null
  const dataRef = useRef({})         // { right: {...}, left: {...} }
  const [phase, setPhase] = useState('intro')   // intro | loading | ready | countdown | recording | between | submitting
  const [handIdx, setHandIdx] = useState(0)
  const [detected, setDetected] = useState(false)
  const [fps, setFps] = useState(0)
  const [error, setError] = useState(null)

  const hand = HANDS[handIdx]

  const start = async () => {
    setError(null); setPhase('loading')
    try {
      const [lm, stream] = await Promise.all([
        getLandmarker(),
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } } }),
      ])
      streamRef.current = stream
      const v = videoRef.current
      v.srcObject = stream
      await v.play()
      setPhase('ready')
      loop(lm)
    } catch (e) {
      setError(`Couldn't start the camera or hand tracker: ${e.message}`)
      setPhase('intro')
    }
  }

  const loop = (lm) => {
    const v = videoRef.current, c = canvasRef.current
    if (!v || !c) return
    const ctx = c.getContext('2d')
    let lastT = -1, frames = 0, fpsT = performance.now(), alive = true
    const tick = () => {
      if (!alive || !streamRef.current) return
      if (v.readyState >= 2 && v.currentTime !== lastT) {
        lastT = v.currentTime
        const now = performance.now()
        const res = lm.detectForVideo(v, now)
        const W = v.videoWidth, H = v.videoHeight
        if (c.width !== W) { c.width = W; c.height = H }
        ctx.clearRect(0, 0, W, H)
        const pts = res.landmarks?.[0]
        setDetected(!!pts)
        if (pts) {
          ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(91,140,255,0.8)'
          CONNECTIONS.forEach(([a, b]) => { ctx.beginPath(); ctx.moveTo(pts[a].x * W, pts[a].y * H); ctx.lineTo(pts[b].x * W, pts[b].y * H); ctx.stroke() })
          pts.forEach((p, i) => { ctx.fillStyle = i === 4 || i === 8 ? '#3de0ff' : '#a67bff'; ctx.beginPath(); ctx.arc(p.x * W, p.y * H, i === 4 || i === 8 ? 7 : 4, 0, 7); ctx.fill() })
          ctx.strokeStyle = '#3de0ff'; ctx.lineWidth = 4
          ctx.beginPath(); ctx.moveTo(pts[4].x * W, pts[4].y * H); ctx.lineTo(pts[8].x * W, pts[8].y * H); ctx.stroke()
          const r = recRef.current
          if (r) {
            const xy = (p) => [p.x * W, p.y * H]
            r.t.push(now); r.thumb.push(xy(pts[4])); r.index.push(xy(pts[8])); r.wrist.push(xy(pts[0])); r.middle_mcp.push(xy(pts[9]))
          }
        }
        frames++
        if (now - fpsT > 1000) { setFps(Math.round(frames * 1000 / (now - fpsT))); frames = 0; fpsT = now }
      }
      requestAnimationFrame(tick)
    }
    tick()
    return () => { alive = false }
  }

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), [])

  const countdownElapsed = useTimer(phase === 'countdown', 3000, () => {
    recRef.current = { t: [], thumb: [], index: [], wrist: [], middle_mcp: [] }
    beep(880); setPhase('recording')
  })
  const recElapsed = useTimer(phase === 'recording', TRIAL_MS, () => {
    dataRef.current[hand] = recRef.current
    recRef.current = null
    beep(440)
    if (handIdx < HANDS.length - 1) { setHandIdx(handIdx + 1); setPhase('between') } else finish()
  })

  const finish = async () => {
    setPhase('submitting')
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    const ok = await onSubmit({ hands: dataRef.current })
    if (!ok) { dataRef.current = {}; setHandIdx(0); setPhase('intro') }
  }

  const skipLeft = () => { finish() }
  const framesCaptured = dataRef.current[hand]?.t.length

  return (
    <div className="stage stage-center">
      {phase === 'intro' && (
        <>
          <h2>Finger tapping</h2>
          <p className="instructions">
            Sit about an arm's length from the camera with good light. Hold one hand up, palm facing the camera.
            When recording starts, <b>tap your index finger and thumb together as fast and as wide as you can</b> for 10 seconds.
            Right hand first, then left.
          </p>
          <p className="dim small">Only 21 hand-landmark coordinates per frame are sent. No video leaves your device.</p>
          {error && <div className="error">{error}</div>}
          <button className="btn primary big" onClick={start}>Start camera</button>
        </>
      )}

      <div className="camera-box" style={{ display: ['intro', 'submitting'].includes(phase) ? 'none' : 'block' }}>
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        <div className="camera-hud">
          <span className="hud-pill" style={{ color: detected ? 'var(--good)' : 'var(--warn)' }}>{detected ? '● hand tracked' : '○ show your hand'}</span>
          <span className="hud-pill">{fps} fps</span>
        </div>
      </div>

      {phase === 'loading' && <p className="muted">Loading hand-tracking model…</p>}
      {(phase === 'ready' || phase === 'between') && (
        <div className="stack" style={{ alignItems: 'center' }}>
          {phase === 'between' && <p className="muted small">Right hand captured. Now switch hands.</p>}
          <h2 style={{ textTransform: 'capitalize' }}>{hand} hand</h2>
          <div className="row">
            <button className="btn primary big" disabled={!detected} onClick={() => setPhase('countdown')}>
              {detected ? 'Record 10 s' : 'Waiting for hand…'}
            </button>
            {phase === 'between' && <button className="btn ghost" onClick={skipLeft}>Skip left hand</button>}
          </div>
        </div>
      )}
      {phase === 'countdown' && <div className="countdown">{Math.ceil((3000 - countdownElapsed) / 1000)}</div>}
      {phase === 'recording' && (
        <>
          <div className="row"><span className="tiny" style={{ color: 'var(--bad)' }}>● recording · {hand} hand</span>
            <span className="mono small muted">{((TRIAL_MS - recElapsed) / 1000).toFixed(1)} s</span></div>
          <div className="progress"><div style={{ width: `${(recElapsed / TRIAL_MS) * 100}%` }} /></div>
          <p className="muted">Tap fast and wide!</p>
        </>
      )}
      {phase === 'submitting' && <p className="muted">Extracting tap features{framesCaptured ? ` from ${framesCaptured} frames` : ''}…</p>}
    </div>
  )
}
