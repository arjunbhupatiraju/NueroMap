import { useEffect, useRef, useState } from 'react'
import { beep, useTimer } from '../lib/useCountdown.js'

const CONFIG = {
  gait: {
    title: 'Walking',
    ms: 30000,
    text: <>Hold the phone flat against the middle of your chest with both hands (or put it in a front pocket). After the beep, <b>walk normally in a straight line</b> (a hallway is ideal) until the second beep, about 30 seconds. Turn around if you run out of space.</>,
  },
  balance: {
    title: 'Standing balance',
    ms: 20000,
    text: <>Stand with <b>feet together</b>, hold the phone flat against your chest with both hands, and look straight ahead. After the beep, <b>stay as still as you can</b> until the second beep, about 20 seconds. Stand near a wall or a chair in case you need support.</>,
  },
}

export const sensorsAvailable = () => typeof window !== 'undefined' && 'DeviceMotionEvent' in window && navigator.maxTouchPoints > 0

export default function SensorLab({ mode, onSubmit }) {
  const cfg = CONFIG[mode]
  const [phase, setPhase] = useState('intro')  // intro | countdown | recording | submitting
  const [samples, setSamples] = useState(0)
  const [error, setError] = useState(null)
  const buf = useRef(null)
  const handler = useRef(null)

  const detach = () => { if (handler.current) window.removeEventListener('devicemotion', handler.current); handler.current = null }
  useEffect(() => detach, [])

  const start = async () => {
    setError(null)
    try {
      if (typeof DeviceMotionEvent?.requestPermission === 'function') {
        const r = await DeviceMotionEvent.requestPermission()   // iOS: must be called from a tap
        if (r !== 'granted') throw new Error('Motion permission denied')
      }
      // Check that events actually arrive
      const got = await new Promise((res) => {
        const h = (e) => { window.removeEventListener('devicemotion', h); res(!!e.accelerationIncludingGravity?.x || e.accelerationIncludingGravity?.x === 0) }
        window.addEventListener('devicemotion', h)
        setTimeout(() => { window.removeEventListener('devicemotion', h); res(false) }, 1500)
      })
      if (!got) throw new Error('No motion sensor data. This test needs a phone (and HTTPS).')
      setPhase('countdown')
    } catch (e) { setError(e.message) }
  }

  const countdown = useTimer(phase === 'countdown', 3000, () => {
    buf.current = { t: [], acc: [], gyro: [] }
    handler.current = (e) => {
      const a = e.accelerationIncludingGravity, r = e.rotationRate
      if (!a || a.x === null) return
      buf.current.t.push(performance.now())
      buf.current.acc.push([a.x, a.y, a.z])
      buf.current.gyro.push([r?.alpha ?? 0, r?.beta ?? 0, r?.gamma ?? 0])
    }
    window.addEventListener('devicemotion', handler.current)
    beep(880)
    setPhase('recording')
  })

  const elapsed = useTimer(phase === 'recording', cfg.ms, async () => {
    detach(); beep(440); setTimeout(() => beep(440), 250)
    setPhase('submitting')
    const ok = await onSubmit(buf.current)
    if (!ok) setPhase('intro')
  })

  useEffect(() => {
    if (phase !== 'recording') return
    const id = setInterval(() => setSamples(buf.current?.t.length ?? 0), 250)
    return () => clearInterval(id)
  }, [phase])

  return (
    <div className="stage stage-center">
      <h2>{cfg.title}</h2>
      {phase === 'intro' && (
        <>
          <p className="instructions">{cfg.text}</p>
          {error && <div className="error">{error}</div>}
          <button className="btn primary big" onClick={start}>I'm in position, start</button>
        </>
      )}
      {phase === 'countdown' && <div className="countdown">{Math.ceil((3000 - countdown) / 1000)}</div>}
      {phase === 'recording' && (
        <>
          <div className="countdown">{Math.ceil((cfg.ms - elapsed) / 1000)}</div>
          <div className="progress"><div style={{ width: `${(elapsed / cfg.ms) * 100}%` }} /></div>
          <p className="muted">{mode === 'gait' ? 'Keep walking…' : 'Stay still…'} <span className="mono dim">{samples} samples</span></p>
        </>
      )}
      {phase === 'submitting' && <p className="muted">Removing gravity, detecting {mode === 'gait' ? 'steps' : 'sway'}…</p>}
    </div>
  )
}
