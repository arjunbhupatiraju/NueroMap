import { useEffect, useRef, useState } from 'react'

// Runs a timed phase: returns elapsed fraction and calls onDone after `ms`.
export function useTimer(active, ms, onDone) {
  const [elapsed, setElapsed] = useState(0)
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    if (!active) { setElapsed(0); return }
    const start = performance.now()
    let raf
    const tick = () => {
      const e = performance.now() - start
      setElapsed(Math.min(e, ms))
      if (e >= ms) done.current?.()
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, ms])
  return elapsed
}

export function beep(freq = 880, dur = 0.15) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    const ctx = new Ctx()
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.value = freq
    g.gain.setValueAtTime(0.25, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
    o.connect(g).connect(ctx.destination)
    o.start(); o.stop(ctx.currentTime + dur)
    setTimeout(() => ctx.close(), (dur + 0.1) * 1000)
  } catch { /* no audio */ }
  try { navigator.vibrate?.(200) } catch { /* no vibration */ }
}
