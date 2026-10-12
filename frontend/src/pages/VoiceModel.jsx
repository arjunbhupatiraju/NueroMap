import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'

const pct = (v) => `${Math.round(v * 100)}%`

function Stat({ value, label }) {
  return (
    <div className="vm-stat">
      <div className="vm-stat-v">{value}</div>
      <div className="vm-stat-l">{label}</div>
    </div>
  )
}

export default function VoiceModel() {
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const [sel, setSel] = useState(null)
  const [person, setPerson] = useState(null)
  const [tried, setTried] = useState({})

  useEffect(() => { api.voiceModel().then(setInfo).catch((e) => setError(e.message)) }, [])

  const pick = async (n) => {
    setSel(n); setPerson(null)
    try {
      const p = await api.voiceModelPerson(n)
      setPerson(p)
      setTried((t) => ({ ...t, [n]: p.predicted_parkinsons === p.actual_parkinsons }))
    } catch (e) { setError(e.message) }
  }

  if (error) return <div className="error">{error}</div>
  if (!info) return <div className="panel muted">Loading the voice model…</div>

  const h = info.held_out_test
  const cv = info.cross_validation_development[info.model]
  const nTried = Object.keys(tried).length
  const nRight = Object.values(tried).filter(Boolean).length

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <div className="tiny muted">Research · experimental</div>
        <h1>Parkinson's voice model</h1>
        <p className="muted report-intro">
          A machine-learning model trained on a public dataset to tell voices of people with Parkinson's from
          voices of people without it. It is a research experiment: it is not part of NeuroMap's scoring and it
          is not a diagnosis.
        </p>
      </div>

      <section className="panel stack">
        <div className="tiny muted">How it was trained</div>
        <p>
          <b>Data:</b> {info.dataset}: {info.recordings} sustained-vowel recordings from {info.people} people
          ({info.parkinsons_people} with Parkinson's), {info.features} voice features each.
        </p>
        <p>
          <b>Model:</b> gradient-boosted decision trees (scikit-learn), weighted for the 3-to-1 class imbalance.
          {' '}<b>Testing:</b> {h.people} people were set aside before training and used only once, at the end.
          Every split keeps all of a person's recordings together, so the model is always judged on voices it has never heard.
        </p>
      </section>

      <section className="panel stack">
        <div className="tiny muted">Results on {h.people} people the model never saw</div>
        <div className="vm-stats">
          <Stat value={pct(h.accuracy)} label="overall accuracy" />
          <Stat value={pct(h.sensitivity)} label="of people with Parkinson's correctly flagged" />
          <Stat value={pct(h.specificity)} label="of people without Parkinson's correctly cleared" />
          <Stat value={h.roc_auc.toFixed(2)} label="ROC AUC (0.5 = guessing, 1.0 = perfect)" />
        </div>
        <p className="small muted">
          Cross-validation on the other {cv.people} people: {pct(cv.accuracy)} accuracy, ROC AUC {cv.roc_auc.toFixed(2)}.
          Always guessing "Parkinson's" would score {pct(info.always_guess_parkinsons_accuracy)} on the held-out people,
          so the useful signal is in the balance of flagged and cleared. The held-out group is small, so these numbers
          could shift by several points on new data.
        </p>
      </section>

      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="tiny muted">Try it on a held-out person</div>
          {nTried > 0 && <span className="chip">{nRight} / {nTried} correct so far</span>}
        </div>
        <div className="vm-people">
          {Array.from({ length: info.held_out_people }, (_, i) => i + 1).map((n) => (
            <button key={n} className={`vm-person ${sel === n ? 'active' : ''} ${n in tried ? (tried[n] ? 'right' : 'wrong') : ''}`}
                    onClick={() => pick(n)}>{n}</button>
          ))}
        </div>
        {person && (
          <div className="vm-result">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>Person {person.person}</h3>
              <span className={`chip ${person.predicted_parkinsons === person.actual_parkinsons ? 'good' : 'bad'}`}>
                {person.predicted_parkinsons === person.actual_parkinsons ? 'Model was correct' : 'Model was wrong'}
              </span>
            </div>
            <div className="vm-bar"><div className="vm-bar-fill" style={{ width: pct(person.probability) }} /><div className="vm-bar-mid" /></div>
            <div className="row small" style={{ justifyContent: 'space-between' }}>
              <span className="muted">Parkinson's-like voice score: <span className="mono">{pct(person.probability)}</span> (average of {person.recordings.length} recordings: {person.recordings.map(pct).join(', ')})</span>
            </div>
            <div className="row">
              <span className="chip">Model says: {person.predicted_parkinsons ? "Parkinson's-like" : 'healthy-like'}</span>
              <span className="chip">Actual: {person.actual_parkinsons ? "has Parkinson's" : "no Parkinson's"}</span>
            </div>
          </div>
        )}
      </section>

      <section className="panel stack">
        <div className="tiny muted">Why it doesn't score your voice yet</div>
        <p className="muted">
          The dataset was recorded as a held "ahh" and analysed with 753 specialised features, while NeuroMap's Voice Lab
          records a read-aloud passage. Running this model on NeuroMap recordings would mean feeding it a kind of data it
          was never trained or tested on, so its answers could not be trusted. The next step is to add a sustained-vowel
          task, compute matching features, and validate the model on those recordings before it ever scores a user.
        </p>
      </section>
    </div>
  )
}
