import { useEffect, useRef, useState } from 'react'
import { blobToWav } from '../lib/wav.js'

// Original standard passage: same text every session so measurements are comparable.
// Mix of voiced sounds, stops, fricatives, and natural phrase breaks at the commas and periods.
export const PASSAGE =
  'Every morning, the baker opens the shop before the city wakes. She measures flour, sugar, and a pinch of salt, ' +
  'then kneads the dough slowly while the radio hums in the corner. By seven o’clock, a line of sleepy neighbors ' +
  'waits by the window. Some want warm bread, some want coffee, and a few just want to talk about the weather. ' +
  'When the last loaf is gone, she washes the bowls, locks the door, and walks home along the quiet river.'

const MIN_S = 8, MAX_S = 60

export default function VoiceLab({ onSubmit }) {
  const [phase, setPhase] = useState('intro') // intro | recording | submitting
  const [secs, setSecs] = useState(0)
  const [error, setError] = useState(null)
  const canvasRef = useRef(null)
  const rec = useRef({})

  const cleanup = () => {
    const r = rec.current
    cancelAnimationFrame(r.raf); clearInterval(r.timer)
    r.stream?.getTracks().forEach((t) => t.stop())
    r.ctx?.close().catch(() => {})
  }
  useEffect(() => cleanup, [])

  const start = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      })
      const Ctx = window.AudioContext || window.webkitAudioContext
      const ctx = new Ctx()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      ctx.createMediaStreamSource(stream).connect(analyser)
      const mr = new MediaRecorder(stream)
      const chunks = []
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      mr.start(250)
      const t0 = performance.now()
      rec.current = { stream, ctx, analyser, mr, chunks, t0, levels: [] }
      rec.current.timer = setInterval(() => {
        const s = (performance.now() - t0) / 1000
        setSecs(s)
        if (s >= MAX_S) stop()
      }, 100)
      setPhase('recording')
      draw()
    } catch (e) {
      setError(`Microphone unavailable: ${e.message}`)
    }
  }

  const draw = () => {
    const r = rec.current, c = canvasRef.current
    if (!c || !r.analyser) return
    const buf = new Float32Array(r.analyser.fftSize)
    r.analyser.getFloatTimeDomainData(buf)
    const rms = Math.sqrt(buf.reduce((a, b) => a + b * b, 0) / buf.length)
    const db = Math.max(0, Math.min(1, (20 * Math.log10(rms + 1e-8) + 60) / 60))
    r.levels.push(db)
    if (r.levels.length > 200) r.levels.shift()
    const ctx = c.getContext('2d')
    const W = (c.width = c.clientWidth * 2), H = (c.height = c.clientHeight * 2)
    ctx.clearRect(0, 0, W, H)
    const bw = W / 200
    r.levels.forEach((l, i) => {
      const h = Math.max(2, l * H)
      ctx.fillStyle = l > 0.45 ? '#a67bff' : '#2a3558'
      ctx.fillRect(i * bw, (H - h) / 2, bw * 0.7, h)
    })
    r.raf = requestAnimationFrame(draw)
  }

  const stop = async () => {
    const r = rec.current
    if (!r.mr || r.mr.state === 'inactive') return
    const done = new Promise((res) => (r.mr.onstop = res))
    r.mr.stop()
    await done
    const type = r.mr.mimeType || 'audio/webm'
    cleanup()
    setPhase('submitting')
    try {
      const wav = await blobToWav(new Blob(r.chunks, { type }))
      const passageWords = PASSAGE.trim().split(/\s+/).length
      const ok = await onSubmit(wav, passageWords)
      if (!ok) setPhase('intro')
    } catch (e) {
      setError(`Couldn't process the recording: ${e.message}`)
      setPhase('intro')
    }
  }

  return (
    <div className="stage stage-center">
      <h2>Read aloud</h2>
      {phase === 'intro' && (
        <p className="instructions">
          In a quiet room, hold the device about 30 cm from your mouth and <b>read the passage below at your normal pace and volume</b>.
          The same passage is used every session so your measurements can be compared over time. Nothing is transcribed.
        </p>
      )}
      <div className="passage">{PASSAGE}</div>
      {phase === 'recording' && (
        <>
          <canvas ref={canvasRef} className="level" />
          <div className="row">
            <span className="tiny" style={{ color: 'var(--bad)' }}>● recording</span>
            <span className="mono small muted">{secs.toFixed(1)} s</span>
          </div>
          <button className="btn primary big" disabled={secs < MIN_S} onClick={stop}>
            {secs < MIN_S ? `Keep reading… (${Math.ceil(MIN_S - secs)})` : 'Done reading'}
          </button>
        </>
      )}
      {phase === 'intro' && <button className="btn primary big" onClick={start}>Start recording</button>}
      {phase === 'submitting' && <p className="muted">Analysing pitch, pauses and loudness…</p>}
      {error && <div className="error">{error}</div>}
    </div>
  )
}
