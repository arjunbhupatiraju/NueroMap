import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { LAB_LABEL } from '../lib/fmt.js'
import FeatureTable from '../components/FeatureTable.jsx'
import MotorLab from '../labs/MotorLab.jsx'
import VoiceLab from '../labs/VoiceLab.jsx'
import CognitiveLab from '../labs/CognitiveLab.jsx'
import SensorLab, { sensorsAvailable } from '../labs/SensorLab.jsx'

const ORDER = ['motor', 'voice', 'cognitive', 'gait', 'balance']
const BLURB = {
  motor: 'Camera · 20 s',
  voice: 'Microphone · ~30 s',
  cognitive: 'Screen · ~2 min',
  gait: 'Phone sensors · 30 s',
  balance: 'Phone sensors · 20 s',
}

export default function Assessment({ registry, profile, go, refreshProfiles }) {
  const [aid, setAid] = useState(null)
  const [active, setActive] = useState('motor')
  const [status, setStatus] = useState({})    // lab -> 'done' | 'skipped'
  const [results, setResults] = useState({})  // lab -> {features, trace}
  const [error, setError] = useState(null)
  const [showResult, setShowResult] = useState(null)
  const hasSensors = sensorsAvailable()

  useEffect(() => {
    if (!profile) return
    api.newAssessment(profile).then((r) => setAid(r.id)).catch((e) => setError(e.message))
  }, [profile])

  if (!profile) {
    return (
      <div className="panel stack stage-center" style={{ alignItems: 'center', padding: 40 }}>
        <h2>Create a profile first</h2>
        <button className="btn primary" onClick={() => go('dashboard')}>Go to profile</button>
      </div>
    )
  }

  const nextLab = (after) => {
    const i = ORDER.indexOf(after)
    return ORDER.slice(i + 1).find((l) => !status[l]) ?? ORDER.find((l) => !status[l] && l !== after) ?? null
  }

  const submit = (lab) => async (raw, passageWords) => {
    setError(null)
    try {
      const res = lab === 'voice' ? await api.submitVoice(aid, raw, passageWords) : await api.submitLab(aid, lab, raw)
      setResults((r) => ({ ...r, [lab]: res }))
      setStatus((s) => ({ ...s, [lab]: 'done' }))
      setShowResult(lab)
      refreshProfiles()
      return true
    } catch (e) {
      setError(`${LAB_LABEL[lab]}: ${e.message}`)
      return false
    }
  }

  const skip = (lab) => {
    setStatus((s) => ({ ...s, [lab]: 'skipped' }))
    setShowResult(null)
    const n = nextLab(lab)
    if (n) setActive(n)
  }

  const cont = () => {
    const n = nextLab(active)
    setShowResult(null)
    if (n) setActive(n)
  }

  const allDone = ORDER.every((l) => status[l])
  const anyDone = ORDER.some((l) => status[l] === 'done')
  const needsPhone = (l) => (l === 'gait' || l === 'balance') && !hasSensors

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="tiny muted">Assessment · {profile}</div>
          <h1>Virtual neurology lab</h1>
        </div>
        {anyDone && <button className="btn primary" onClick={() => go('dashboard')}>{allDone ? 'See results' : 'Finish early'}</button>}
      </div>

      <div className="steps">
        {ORDER.map((l) => (
          <button key={l} className={`step ${active === l ? 'active' : ''} ${status[l] ?? ''}`}
                  onClick={() => { setActive(l); setShowResult(status[l] === 'done' ? l : null) }}>
            <div className="step-name">{LAB_LABEL[l]}</div>
            <div className="step-status">
              {status[l] === 'done' ? '✓ captured' : status[l] === 'skipped' ? 'skipped' : needsPhone(l) ? 'needs a phone' : BLURB[l]}
            </div>
          </button>
        ))}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="panel">
        {showResult === active && results[active] ? (
          <div className="stage">
            <div className="panel-head">
              <h2>{LAB_LABEL[active]}: captured</h2>
              <button className="btn ghost small" onClick={() => setShowResult(null)}>Redo</button>
            </div>
            <FeatureTable registry={registry} features={results[active].features} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              {nextLab(active)
                ? <button className="btn primary" onClick={cont}>Next: {LAB_LABEL[nextLab(active)]} →</button>
                : <button className="btn primary" onClick={() => go('dashboard')}>See results →</button>}
            </div>
          </div>
        ) : needsPhone(active) ? (
          <div className="stage stage-center">
            <h2>{LAB_LABEL[active]} needs a phone</h2>
            <p className="instructions">
              This test uses the accelerometer. Open NeuroMap on your phone (see README: <span className="mono">npm run phone</span>)
              and run just the phone labs there, or skip it for this session.
            </p>
            <button className="btn" onClick={() => skip(active)}>Skip for now</button>
          </div>
        ) : (
          <>
            {!aid ? <p className="muted">Starting session…</p> : (
              <>
                {active === 'motor' && <MotorLab key={`m${aid}`} onSubmit={submit('motor')} />}
                {active === 'voice' && <VoiceLab key={`v${aid}`} onSubmit={submit('voice')} />}
                {active === 'cognitive' && <CognitiveLab key={`c${aid}`} onSubmit={submit('cognitive')} />}
                {(active === 'gait' || active === 'balance') && <SensorLab key={active} mode={active} onSubmit={submit(active)} />}
              </>
            )}
            {status[active] !== 'done' && (
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn ghost small" onClick={() => skip(active)}>Skip this lab</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
