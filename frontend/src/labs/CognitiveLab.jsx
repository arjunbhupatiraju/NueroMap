import { useEffect, useRef, useState } from 'react'

const RT_TRIALS = 15
const SPAN_START = 3, SPAN_MAX = 10

// ---------------- Reaction time ----------------
function ReactionTask({ onDone }) {
  const [state, setState] = useState('ready')   // ready | wait | go | early | result
  const [last, setLast] = useState(null)
  const trials = useRef([])
  const stim = useRef(null)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  const arm = () => {
    setState('wait')
    stim.current = null
    timer.current = setTimeout(() => {
      stim.current = performance.now()
      setState('go')
    }, 1500 + Math.random() * 2500)
  }

  const press = (e) => {
    e.preventDefault()
    const now = performance.now()
    if (state === 'ready' || state === 'result' || state === 'early') { arm(); return }
    if (state === 'wait') {
      clearTimeout(timer.current)
      trials.current.push({ stimulus_ms: now, response_ms: now, false_start: true })
      setState('early')
      return
    }
    if (state === 'go') {
      const rt = now - stim.current
      trials.current.push({ stimulus_ms: stim.current, response_ms: now, false_start: false })
      setLast(rt)
      const valid = trials.current.filter((t) => !t.false_start).length
      if (valid >= RT_TRIALS) { setState('done'); onDone(trials.current) }
      else { setState('result'); timer.current = setTimeout(arm, 700) }
    }
  }

  useEffect(() => {
    const onKey = (e) => { if (e.code === 'Space') press(e) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const valid = trials.current.filter((t) => !t.false_start).length
  const label = {
    ready: 'Tap here (or press space) to begin',
    wait: 'Wait for it…',
    go: 'TAP!',
    early: 'Too early! Tap to continue',
    result: `${Math.round(last)} ms`,
    done: 'Done',
  }[state]

  return (
    <>
      <p className="instructions">When the box turns <b style={{ color: 'var(--cyan)' }}>bright cyan</b>, tap it (or press space) as fast as you can. Don't anticipate.</p>
      <div className={`rt-area ${state === 'go' ? 'go' : state === 'early' ? 'early' : 'wait'}`} onPointerDown={press}>{label}</div>
      <div className="mono small muted">trial {Math.min(valid + 1, RT_TRIALS)} / {RT_TRIALS}</div>
    </>
  )
}

// ---------------- Digit span ----------------
function SpanTask({ onDone }) {
  const [len, setLen] = useState(SPAN_START)
  const [seq, setSeq] = useState([])
  const [shown, setShown] = useState(null)
  const [phase, setPhase] = useState('ready') // ready | show | input | feedback
  const [input, setInput] = useState('')
  const [feedback, setFeedback] = useState(null)
  const trials = useRef([])
  const failsAtLen = useRef(0)

  const present = (L) => {
    const s = Array.from({ length: L }, () => Math.floor(Math.random() * 10))
    setSeq(s); setInput(''); setPhase('show')
    s.forEach((d, i) => {
      setTimeout(() => setShown(d), i * 1000)
      setTimeout(() => setShown(null), i * 1000 + 750)
    })
    setTimeout(() => setPhase('input'), L * 1000)
  }

  const submit = () => {
    const correct = input === seq.join('')
    trials.current.push({ length: len, correct })
    setFeedback(correct); setPhase('feedback')
    let next = len
    if (correct) { failsAtLen.current = 0; next = len + 1 } else { failsAtLen.current += 1 }
    const finished = failsAtLen.current >= 2 || next > SPAN_MAX
    setTimeout(() => {
      if (finished) { onDone(trials.current); return }
      setLen(next); present(next)
    }, 900)
  }

  const key = (k) => {
    if (phase !== 'input') return
    if (k === '⌫') setInput((s) => s.slice(0, -1))
    else if (k === '✓') { if (input.length) submit() }
    else if (input.length < len) setInput((s) => s + k)
  }

  useEffect(() => {
    const onKey = (e) => {
      if (/^[0-9]$/.test(e.key)) key(e.key)
      else if (e.key === 'Backspace') key('⌫')
      else if (e.key === 'Enter') key('✓')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <>
      <p className="instructions">Digits appear one at a time. Then <b>type them back in the same order</b>. The sequences get longer until you miss two in a row.</p>
      {phase === 'ready' && <button className="btn primary big" onClick={() => present(len)}>Start digit span</button>}
      {phase !== 'ready' && (
        <>
          <div className="mono small muted">{len} digits</div>
          <div className="digits">
            {phase === 'show' ? (shown ?? '') : phase === 'feedback'
              ? <span style={{ color: feedback ? 'var(--good)' : 'var(--bad)', fontSize: 40 }}>{feedback ? 'Correct' : seq.join('')}</span>
              : (input.padEnd(len, '·'))}
          </div>
          {phase === 'input' && (
            <div className="keypad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((k) => (
                <button key={k} onClick={() => key(k)} style={k === '✓' ? { color: 'var(--cyan)' } : undefined}>{k}</button>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}

export default function CognitiveLab({ onSubmit }) {
  const [part, setPart] = useState('intro')
  const reaction = useRef(null)

  return (
    <div className="stage stage-center">
      {part === 'intro' && (
        <>
          <h2>Cognitive tasks</h2>
          <p className="instructions">Two short tasks: <b>simple reaction time</b> ({RT_TRIALS} trials) and <b>digit span</b> (working memory). About 2 minutes total.</p>
          <button className="btn primary big" onClick={() => setPart('reaction')}>Begin</button>
        </>
      )}
      {part === 'reaction' && (
        <>
          <h2>1 · Reaction time</h2>
          <ReactionTask onDone={(t) => { reaction.current = t; setTimeout(() => setPart('span'), 400) }} />
        </>
      )}
      {part === 'span' && (
        <>
          <h2>2 · Digit span</h2>
          <SpanTask onDone={async (s) => {
            setPart('submitting')
            const ok = await onSubmit({ reaction: reaction.current, span: s })
            if (!ok) setPart('intro')
          }} />
        </>
      )}
      {part === 'submitting' && <p className="muted">Computing reaction-time distribution and span…</p>}
    </div>
  )
}
