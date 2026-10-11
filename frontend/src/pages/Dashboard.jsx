import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import NeuroMapViz from '../components/NeuroMapViz.jsx'
import { DOMAIN_HEX, DOMAIN_LABEL, LAB_LABEL, adverseZ, fmt, fmtDate, scoreColor } from '../lib/fmt.js'

function average(values) {
  const clean = values.filter((v) => Number.isFinite(v))
  if (!clean.length) return null
  return clean.reduce((sum, v) => sum + v, 0) / clean.length
}

function featureImportanceForDomain(latest, domain, byKey) {
  if (!latest || !latest.z) return []
  const rows = Object.entries(latest.z)
    .map(([key, z]) => {
      const f = byKey[key]
      if (!f || f.domain !== domain) return null
      const adv = adverseZ(f, z)
      if (adv === null || adv <= 0) return null
      return { key, label: f.label, adv, domain: f.domain }
    })
    .filter(Boolean)
    .sort((a, b) => b.adv - a.adv)

  const total = rows.reduce((sum, item) => sum + item.adv, 0)
  if (!total) return []
  return rows.slice(0, 4).map((item) => ({
    key: item.key,
    label: item.label,
    adv: item.adv,
    share: item.adv / total,
  }))
}

function patternFrequency(assessments, domain, byKey) {
  const recent = assessments.filter((assessment) => !assessment.calibrating).slice(-4)
  const count = recent.filter((assessment) => Object.entries(assessment.z ?? {}).some(([key, z]) => {
    const feature = byKey[key]
    return feature?.domain === domain && (adverseZ(feature, z) ?? -Infinity) > 1
  })).length
  return { count, total: recent.length }
}

function reliabilityForDomain(completeAssessments, domain, byKey) {
  const keys = Object.keys(byKey).filter((key) => byKey[key].domain === domain)
  if (!keys.length || completeAssessments.length < 2) return { score: null, label: 'Not enough sessions' }

  const recent = completeAssessments.slice(-Math.min(4, completeAssessments.length))
  const values = keys.map((key) => {
    const series = recent.map((a) => a.features?.[key]).filter((v) => Number.isFinite(v))
    if (series.length < 2) return null
    const mean = average(series)
    if (mean === null || mean === 0) return null
    const variance = series.reduce((sum, v) => sum + (v - mean) ** 2, 0) / series.length
    return Math.sqrt(variance) / Math.abs(mean)
  }).filter((v) => v !== null)

  if (!values.length) return { score: null, label: 'Not enough sessions' }
  const instability = average(values)
  const score = clamp(100 / (1 + instability), 0, 100)
  if (score >= 88) return { score: Math.round(score), label: 'High Stability' }
  if (score >= 74) return { score: Math.round(score), label: 'Moderate Stability' }
  return { score: Math.round(score), label: 'Low Stability' }
}

function baselineConfidenceForDomain(assessments, domain, registry, windowSize) {
  const domainFeatures = registry.features.filter((feature) => feature.domain === domain)
  const count = assessments.slice(0, windowSize).filter((assessment) =>
    domainFeatures.some((feature) => Number.isFinite(assessment.features?.[feature.key])),
  ).length
  if (count >= 6) return { label: 'High', detail: `${count} baseline sessions` }
  if (count >= 4) return { label: 'Moderate', detail: `${count} baseline sessions` }
  return { label: 'Low', detail: `${count} sessions` }
}

function domainTrend(assessments, domain) {
  const values = assessments.map((assessment) => assessment.scores?.[domain]).filter(Number.isFinite)
  if (values.length < 4) return { label: 'Not enough history', delta: null }
  const width = Math.min(3, Math.floor(values.length / 2))
  const recent = average(values.slice(-width))
  const previous = average(values.slice(-width * 2, -width))
  if (previous === null) return { label: 'Building history', delta: null }
  const delta = recent - previous
  return { label: delta < -3 ? 'Declining' : delta > 3 ? 'Improving' : 'Stable', delta }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function domainNarrative(domain, score, primary, changePoints, frequency) {
  const deficit = Math.max(0, 100 - (score ?? 100))
  const change = changePoints.find((item) => item.domain === domain)

  return {
    headline: `${DOMAIN_LABEL[domain]} score is ${Math.round(deficit)} points below your personal baseline index.`,
    contributors: primary.length ? primary.slice(0, 3) : [],
    confidence: change?.fit_improvement >= 0.75 ? 'Moderate' : 'Low',
    pattern: change
      ? `A possible shift starts ${change.change}. The score level changed by ${fmt(Math.abs(change.delta), 1)} points.`
      : frequency.total
        ? `A >1 SD feature shift appeared in ${frequency.count} of the last ${frequency.total} scored assessments.`
        : 'No threshold-level change point was detected in the available history.',
  }
}

function ProfilePicker({ profiles, profile, setProfile, refreshProfiles }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const seed = async () => {
    setBusy(true)
    try {
      const { profile: p } = await api.seedDemo()
      await refreshProfiles()
      setProfile(p)
    } finally { setBusy(false) }
  }
  return (
    <div className="stack">
      <div className="row">
        <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)}
               onKeyDown={(e) => e.key === 'Enter' && name.trim() && setProfile(name.trim())} />
        <button className="btn" disabled={!name.trim()} onClick={() => setProfile(name.trim())}>Create profile</button>
      </div>
      {profiles.length > 0 && (
        <div className="row">
          <span className="muted small">or open</span>
          {profiles.map((p) => (
            <button key={p.profile} className={`btn ${p.profile === profile ? '' : 'ghost'}`} onClick={() => setProfile(p.profile)}>
              {p.profile} <span className="dim small">({p.n})</span>
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <button className="btn ghost" onClick={seed} disabled={busy}>
          {busy ? 'Generating 10 weeks of synthetic signals…' : 'Load synthetic demo profile'}
        </button>
      </div>
    </div>
  )
}

export default function Dashboard({ registry, profiles, profile, setProfile, refreshProfiles, go }) {
  const [tl, setTl] = useState(null)
  const [err, setErr] = useState(null)
  const [showIndex, setShowIndex] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [selectedDomain, setSelectedDomain] = useState(null)

  useEffect(() => {
    setTl(null); setErr(null); setSelectedDomain(null)
    if (profile) api.timeline(profile).then(setTl).catch((e) => setErr(e.message))
  }, [profile])

  if (!profile) {
    return (
      <div className="grid grid-2">
        <div className="panel stack" style={{ justifyContent: 'center', gap: 20 }}>
          <div className="tiny muted">Computational neuroscience lab in your browser</div>
          <h1 style={{ fontSize: 34, lineHeight: 1.15 }}>Build a quantitative, longitudinal map of your neurological function.</h1>
          <p className="muted" style={{ margin: 0 }}>
            NeuroMap measures how you move, speak, walk, balance and react, turns each signal into numbers, and learns
            what's normal <i>for you</i>. After a few sessions it shows how each measurement changes compared with your own baseline.
          </p>
          <ProfilePicker {...{ profiles, profile, setProfile, refreshProfiles }} />
        </div>
        <div className="panel"><NeuroMapViz registry={registry} calibrating /></div>
      </div>
    )
  }

  const list = tl?.assessments ?? []
  const demo = profile === 'Demo (synthetic)'
  const completeLabs = ['motor', 'voice', 'cognitive', 'gait', 'balance']
  const completeAssessments = demo
    ? list.filter((assessment) => completeLabs.every((lab) => assessment.labs.includes(lab)))
    : list
  const latest = completeAssessments[completeAssessments.length - 1] ?? list[list.length - 1]
  const synthetic = latest?.synthetic
  const byKey = Object.fromEntries(registry.features.map((f) => [f.key, f]))
  const nNeeded = tl ? Math.max(0, tl.min_baseline - list.length) : 0

  const changes = latest && !latest.calibrating
    ? Object.entries(latest.z)
      .map(([k, z]) => ({ f: byKey[k], z, adv: adverseZ(byKey[k], z) }))
      .filter((c) => c.f && c.adv !== null && c.adv > 1)
      .sort((a, b) => b.adv - a.adv)
    : []
  const featureChanges = latest && !latest.calibrating
    ? Object.entries(latest.z)
      .map(([key, z]) => ({ f: byKey[key], adv: adverseZ(byKey[key], z) }))
      .filter((item) => item.f && item.adv !== null && Math.abs(item.adv) > 0.75)
    : []
  const adverseChanges = featureChanges.filter((item) => item.adv > 0).sort((a, b) => b.adv - a.adv).slice(0, 3)
  const improvingChanges = featureChanges.filter((item) => item.adv < 0).sort((a, b) => a.adv - b.adv).slice(0, 3)

  const scoredDomains = Object.entries(latest?.scores ?? {})
    .filter(([, score]) => Number.isFinite(score))
    .sort((a, b) => a[1] - b[1])
  const insightDomain = scoredDomains[0]?.[0]
  const activeDomain = selectedDomain || insightDomain
  const changePoints = (tl?.change_points ?? []).map((point) => ({
    ...point,
    change: point.created_at ? fmtDate(point.created_at) : `assessment ${point.assessment_id}`,
  }))
  const activeImportance = activeDomain ? featureImportanceForDomain(latest, activeDomain, byKey) : []
  const activeFrequency = activeDomain ? patternFrequency(completeAssessments, activeDomain, byKey) : { count: 0, total: 0 }
  const activeReliability = activeDomain ? reliabilityForDomain(completeAssessments, activeDomain, byKey) : { score: null, label: 'Not enough sessions' }
  const activeBaseline = activeDomain ? baselineConfidenceForDomain(list, activeDomain, registry, tl?.baseline_window ?? 6) : { label: 'Low', detail: '0 sessions' }
  const activeTrend = activeDomain ? domainTrend(completeAssessments, activeDomain) : { label: 'Not enough history', delta: null }
  const activeNarrative = activeDomain && latest && Number.isFinite(latest.scores?.[activeDomain])
    ? domainNarrative(activeDomain, latest.scores[activeDomain], activeImportance, changePoints, activeFrequency)
    : null
  const insightContributors = latest && insightDomain
    ? Object.entries(latest.z)
      .map(([key, z]) => ({ f: byKey[key], adv: adverseZ(byKey[key], z) }))
      .filter((item) => item.f?.domain === insightDomain && item.adv > 0.5)
      .sort((a, b) => b.adv - a.adv)
      .slice(0, 2)
    : []
  const insightFrequency = insightDomain ? patternFrequency(completeAssessments, insightDomain, byKey) : { count: 0, total: 0 }
  const stabilityIndex = scoredDomains.length
    ? Math.round(scoredDomains.reduce((sum, [, score]) => sum + score, 0) / scoredDomains.length)
    : null
  const largestChanges = latest && !latest.calibrating
    ? Object.entries(latest.z)
      .map(([key, z]) => ({ f: byKey[key], adv: adverseZ(byKey[key], z) }))
      .filter((item) => item.f && item.adv !== null && item.adv > 0)
      .sort((a, b) => b.adv - a.adv)
      .slice(0, 3)
    : []
  const fullyScoredHistory = completeAssessments
    .filter((assessment) => !assessment.calibrating && registry.domains.every((d) => Number.isFinite(assessment.scores?.[d])))
    .map((assessment) => ({
      id: assessment.id,
      score: registry.domains.reduce((sum, d) => sum + assessment.scores[d], 0) / registry.domains.length,
    }))
  const trendWindow = 3
  let overallTrend = null
  if (fullyScoredHistory.length >= trendWindow * 2) {
    const previous = fullyScoredHistory.slice(-trendWindow * 2, -trendWindow)
    const current = fullyScoredHistory.slice(-trendWindow)
    const mean = (items) => items.reduce((sum, item) => sum + item.score, 0) / items.length
    const delta = mean(current) - mean(previous)
    overallTrend = { label: delta > 3 ? 'Improving' : delta < -3 ? 'Declining' : 'Stable', delta }
  }

  const removeAssessment = async (assessment) => {
    if (!window.confirm(`Delete assessment from ${fmtDate(assessment.created_at)}? This cannot be undone.`)) return
    setDeletingId(assessment.id)
    try {
      await api.deleteAssessment(assessment.id)
      setTl(await api.timeline(profile))
      await refreshProfiles()
    } catch (e) {
      setErr(`Couldn't delete assessment: ${e.message}`)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="tiny muted">Neurological profile</div>
          <div className="row">
            <h1>{profile}</h1>
            {synthetic && <span className="chip synthetic">synthetic data</span>}
          </div>
        </div>
        <div className="row">
          <select className="input" value={profile} onChange={(e) => e.target.value === '__new' ? setProfile('') : setProfile(e.target.value)}>
            {!profiles.some((p) => p.profile === profile) && <option value={profile}>{profile}</option>}
            {profiles.map((p) => <option key={p.profile} value={p.profile}>{p.profile}</option>)}
            <option value="__new">+ New / demo profile…</option>
          </select>
          <button className="btn primary" onClick={() => go('assess')}>New assessment</button>
        </div>
      </div>

      {err && <div className="error">{err}</div>}

      {tl && list.length === 0 && (
        <div className="panel stack stage-center" style={{ padding: 40, alignItems: 'center' }}>
          <h2>No assessments yet</h2>
          <p className="muted" style={{ maxWidth: 520, textAlign: 'center' }}>
            A full assessment takes about 4 minutes: finger tapping on camera, reading a short passage, two quick
            cognitive tasks, and (on a phone) a short walk and a balance test. Do {tl.min_baseline} sessions on
            different days to build your personal baseline.
          </p>
          <button className="btn primary big" onClick={() => go('assess')}>Start first assessment</button>
        </div>
      )}

      {latest && (
        <>
          {latest.calibrating && (
            <div className="notice">
              Calibrating your personal baseline: {list.length} of {tl.min_baseline} sessions done.
              {nNeeded > 0 && ` ${nNeeded} more on different days before scores appear.`} Raw measurements are already visible in Research mode.
            </div>
          )}
          <div className="grid grid-2">
            <div className="stack">
              <div className="panel">
                <div className="panel-head">
                  <h2>NeuroMap</h2>
                  <span className="muted small">latest · {fmtDate(latest.created_at)}</span>
                </div>
                <NeuroMapViz registry={registry} scores={latest.scores} z={latest.z}
                             calibrating={latest.calibrating} onDomain={setSelectedDomain}
                             onCenter={() => setShowIndex((shown) => !shown)} />
                {activeNarrative && (
                  <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                    <div className="panel-head">
                      <h3>{DOMAIN_LABEL[activeDomain]} breakdown</h3>
                      <button className="btn ghost small" onClick={() => go('timeline', { domain: activeDomain })}>Open history</button>
                    </div>
                    <p style={{ margin: '0 0 10px' }}><strong>{activeNarrative.headline}</strong></p>
                    <div className="row small" style={{ gap: 8 }}>
                      <span className="chip">Trend: {activeTrend.label}</span>
                      <span className="chip">Baseline: {activeBaseline.label} · {activeBaseline.detail}</span>
                      <span className="chip">Consistency estimate: {activeReliability.score === null ? '—' : `${activeReliability.score}%`}</span>
                    </div>
                    <p className="muted small" style={{ margin: '8px 0 0' }}>{activeNarrative.pattern}</p>
                    <div className="grid grid-2" style={{ marginTop: 12, gap: 16 }}>
                      <div>
                        <div className="tiny muted">Key contributors</div>
                        {activeImportance.length ? activeImportance.slice(0, 3).map((item) => (
                          <div className="row small" key={item.key} style={{ justifyContent: 'space-between', marginTop: 6 }}>
                            <span>{item.label}</span><span className="mono">{fmt(item.share * 100, 0)}%</span>
                          </div>
                        )) : <p className="muted small" style={{ margin: '6px 0 0' }}>No adverse feature shifts to rank.</p>}
                      </div>
                      <div>
                        <div className="tiny muted">Recent history</div>
                        {completeAssessments
                          .filter((assessment) => Number.isFinite(assessment.scores?.[activeDomain]))
                          .slice(-4).reverse().map((assessment) => (
                            <div className="row small" key={assessment.id} style={{ justifyContent: 'space-between', marginTop: 6 }}>
                              <span>{fmtDate(assessment.created_at)}</span><span className="mono">{fmt(assessment.scores[activeDomain], 0)}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                    <p className="muted small" style={{ margin: '10px 0 0' }}>Consistency is an exploratory repeatability estimate from recent sessions, not a validated reliability or clinical score.</p>
                  </div>
                )}
                <div className="row small muted" style={{ justifyContent: 'center', gap: 16 }}>
                  {registry.domains.map((domain) => (
                    <button key={domain} className="btn ghost small" onClick={() => setSelectedDomain(domain)}>
                      <span className="dot" style={{ background: DOMAIN_HEX[domain] }} /> {DOMAIN_LABEL[domain]}
                    </button>
                  ))}
                </div>
                {showIndex && (
                  <div style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 14 }}>
                    <div className="panel-head">
                      <h3>NeuroMap Stability Index</h3>
                      <button className="btn ghost small" onClick={() => setShowIndex(false)} aria-label="Close stability index">Close</button>
                    </div>
                    <div className="row" style={{ gap: 24 }}>
                      <div><div className="tiny muted">Current</div><strong className="mono">{stabilityIndex ?? '—'}</strong></div>
                      <div><div className="tiny muted">Baseline reference</div><strong className="mono">100</strong></div>
                    </div>
                    <div className="tiny muted" style={{ marginTop: 12 }}>Largest changes</div>
                    {largestChanges.length ? (
                      <ol style={{ margin: '6px 0 0', paddingLeft: 22 }}>
                        {largestChanges.map(({ f }) => <li key={f.key}>{f.label} <span className="muted">· {DOMAIN_LABEL[f.domain]}</span></li>)}
                      </ol>
                    ) : <p className="muted small" style={{ margin: '6px 0 0' }}>No scored changes yet.</p>}
                    <p className="muted small" style={{ margin: '10px 0 0' }}>Personal baseline comparison, not a clinical measure.</p>
                  </div>
                )}
              </div>

              <div className="panel">
                <div className="panel-head">
                  <h2>NeuroMap Insights</h2>
                  <span className="tiny dim">Baseline-based interpretation</span>
                </div>
                {latest.calibrating || !insightDomain ? (
                  <p className="muted small" style={{ margin: 0 }}>Insights appear after your personal baseline is built.</p>
                ) : (
                  <>
                    <p style={{ margin: '0 0 12px' }}>
                      <strong>{DOMAIN_LABEL[insightDomain]} score is {Math.round(100 - latest.scores[insightDomain])} points below your baseline index of 100.</strong>
                    </p>
                    <div className="tiny muted">Primary contributors</div>
                    {insightContributors.length ? (
                      <ul style={{ margin: '6px 0 12px', paddingLeft: 20 }}>
                        {insightContributors.map(({ f }) => {
                          const direction = f.higher_is_worse ? 'Increased' : 'Reduced'
                          return <li key={f.key}>{direction} {f.label.toLowerCase()}</li>
                        })}
                      </ul>
                    ) : <p className="muted small" style={{ margin: '6px 0 12px' }}>No single feature stands out from baseline.</p>}
                    <p className="muted small" style={{ margin: 0 }}>
                      <strong>Recent pattern:</strong>{' '}
                      {insightFrequency.total
                        ? `Feature shifts greater than 1 SD appeared in ${insightFrequency.count} of the last ${insightFrequency.total} scored assessments.`
                        : 'Not enough scored assessments to estimate recurrence.'}
                    </p>
                    <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
                      <span className="tiny muted">Overall trend · last {trendWindow} vs previous {trendWindow}</span>
                      <span className={`chip ${overallTrend?.label === 'Declining' ? 'warn' : overallTrend?.label === 'Improving' ? 'good' : ''}`}>
                        {overallTrend?.label ?? 'Not enough complete history'}
                      </span>
                    </div>
                    {overallTrend && <p className="muted small" style={{ margin: '6px 0 0' }}>Composite domain score changed {overallTrend.delta > 0 ? '+' : ''}{fmt(overallTrend.delta, 1)} points between three-assessment averages.</p>}
                    <div className="grid grid-2" style={{ marginTop: 14, gap: 12 }}>
                      <div>
                        <div className="tiny muted">Largest adverse changes</div>
                        {adverseChanges.length ? adverseChanges.map(({ f, adv }) => (
                          <div className="row small" key={f.key} style={{ justifyContent: 'space-between', marginTop: 5 }}>
                            <span>{f.label}</span><span className="mono" style={{ color: 'var(--bad)' }}>+{fmt(adv, 1)} SD</span>
                          </div>
                        )) : <p className="muted small" style={{ margin: '5px 0 0' }}>None beyond the comparison threshold.</p>}
                      </div>
                      <div>
                        <div className="tiny muted">Largest improvements</div>
                        {improvingChanges.length ? improvingChanges.map(({ f, adv }) => (
                          <div className="row small" key={f.key} style={{ justifyContent: 'space-between', marginTop: 5 }}>
                            <span>{f.label}</span><span className="mono" style={{ color: 'var(--good)' }}>{fmt(adv, 1)} SD</span>
                          </div>
                        )) : <p className="muted small" style={{ margin: '5px 0 0' }}>None beyond the comparison threshold.</p>}
                      </div>
                    </div>
                    <p className="muted small" style={{ margin: '8px 0 0' }}>These are changes from personal baseline, not a diagnosis.</p>
                  </>
                )}
              </div>
            </div>

            <div className="stack">
              <div className="panel">
                <div className="panel-head">
                  <h2>Domain scores</h2>
                  <span className="tiny dim">100 = your normal</span>
                </div>
                {registry.domains.map((d) => {
                  const s = latest.scores[d]
                  return (
                    <div key={d} className="dbar" onClick={() => go('timeline', { domain: d })}>
                      <span className="dbar-label" style={{ color: DOMAIN_HEX[d] }}>{DOMAIN_LABEL[d]}</span>
                      <div className="dbar-track">
                        <div className="dbar-fill" style={{ width: `${s ?? 0}%`, background: `linear-gradient(90deg, ${DOMAIN_HEX[d]}55, ${DOMAIN_HEX[d]})` }} />
                      </div>
                      <span className="dbar-val" style={{ color: scoreColor(s) }}>{s === null || s === undefined ? '—' : Math.round(s)}</span>
                    </div>
                  )
                })}
              </div>

              <div className="panel">
                <div className="panel-head"><h2>Changes vs. baseline</h2></div>
                {latest.calibrating ? (
                  <p className="muted small" style={{ margin: 0 }}>Available once your baseline is built.</p>
                ) : changes.length === 0 ? (
                  <p className="muted small" style={{ margin: 0 }}>All measurements are within your normal range.</p>
                ) : (
                  <table className="ftable">
                    <tbody>
                      {changes.slice(0, 6).map(({ f, z, adv }) => (
                        <tr key={f.key}>
                          <td>
                            <span className="dot" style={{ background: DOMAIN_HEX[f.domain], marginRight: 8 }} />
                            {f.label}
                            {latest.sustained.includes(f.key) && <span className="chip bad" style={{ marginLeft: 8 }}>sustained</span>}
                          </td>
                          <td className="num" style={{ color: adv > 2 ? 'var(--bad)' : 'var(--warn)' }}>
                            {z > 0 ? '+' : ''}{fmt(z, 1)} SD
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Domain intelligence</h2>
              <span className="tiny dim">Baseline-relative patterns</span>
            </div>
            <p className="muted small" style={{ margin: '0 0 14px' }}>
              Change points flag a possible score-level shift, not a diagnosis. They require at least five scored sessions, an 8-point difference, and a clear split in the score pattern.
            </p>
            <div className="row" style={{ marginBottom: 14, alignItems: 'flex-start' }}>
              <div>
                <div className="tiny muted">Detected change points</div>
                {changePoints.length ? changePoints.map((point) => (
                  <div className="row small" key={point.domain} style={{ marginTop: 6 }}>
                    <span className="dot" style={{ background: DOMAIN_HEX[point.domain] }} />
                    <strong>{DOMAIN_LABEL[point.domain]}</strong>
                    <span className="muted">{fmt(point.delta, 1)} points from {point.change}</span>
                  </div>
                )) : <div className="muted small" style={{ marginTop: 6 }}>No domain-level shift detected yet.</div>}
              </div>
            </div>
            <div className="grid grid-2">
              {registry.domains.map((domain) => {
                const score = latest.scores?.[domain]
                const importance = featureImportanceForDomain(latest, domain, byKey)
                const trend = domainTrend(completeAssessments, domain)
                const baselineConfidence = baselineConfidenceForDomain(list, domain, registry, tl?.baseline_window ?? 6)
                const consistency = reliabilityForDomain(completeAssessments, domain, byKey)
                const point = changePoints.find((item) => item.domain === domain)
                const frequency = patternFrequency(completeAssessments, domain, byKey)

                return (
                  <article key={domain} style={{ borderTop: `2px solid ${DOMAIN_HEX[domain]}`, padding: '12px 2px' }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <h3 style={{ color: DOMAIN_HEX[domain] }}>{DOMAIN_LABEL[domain]}</h3>
                      <strong className="mono" style={{ color: scoreColor(score) }}>{Number.isFinite(score) ? fmt(score, 0) : '—'}</strong>
                    </div>
                    <div className="row small muted" style={{ marginTop: 5 }}>
                      <span>{trend.label}{trend.delta === null ? '' : ` · ${trend.delta > 0 ? '+' : ''}${fmt(trend.delta, 1)} points`}</span>
                      <span>Baseline {baselineConfidence.label.toLowerCase()} · {baselineConfidence.detail}</span>
                    </div>
                    {frequency.total > 0 && <p className="muted small" style={{ margin: '7px 0 0' }}>Feature shifts &gt;1 SD in {frequency.count} of the last {frequency.total} scored sessions.</p>}
                    {point && <p className="small" style={{ margin: '8px 0 0', color: 'var(--warn)' }}>Possible change point · {point.change}</p>}
                    <div className="tiny muted" style={{ marginTop: 10 }}>Feature importance</div>
                    {importance.length ? importance.slice(0, 3).map((item) => (
                      <div className="row small" key={item.key} style={{ justifyContent: 'space-between', marginTop: 5 }}>
                        <span>{item.label}</span><span className="mono">{fmt(item.share * 100, 0)}%</span>
                      </div>
                    )) : <p className="muted small" style={{ margin: '5px 0 0' }}>No adverse contributors to rank.</p>}
                    <div className="row small muted" style={{ marginTop: 8, justifyContent: 'space-between' }}>
                      <span>Consistency estimate</span>
                      <span className="mono">{consistency.score === null ? '—' : `${consistency.score}%`}</span>
                    </div>
                    <button className="btn ghost small" style={{ marginTop: 5 }} onClick={() => setSelectedDomain(domain)}>Open breakdown</button>
                  </article>
                )
              })}
            </div>
            <p className="muted small" style={{ margin: '10px 0 0' }}>Importance shares describe this session’s adverse standardized deviations. Consistency is an exploratory repeatability estimate, not a validated clinical reliability measure.</p>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Assessments</h2>
              <span className="tiny muted">{list.length} recorded</span>
              <button className="btn ghost small" onClick={() => go('timeline')}>Open timeline →</button>
            </div>
            <table className="ftable">
              <thead><tr><th>Date</th><th>Labs</th><th>Change index</th><th /></tr></thead>
              <tbody>
                {[...list].reverse().map((a) => (
                  <tr key={a.id}>
                    <td>{fmtDate(a.created_at)} {a.calibrating && <span className="chip" style={{ marginLeft: 6 }}>baseline</span>}</td>
                    <td className="muted small">{a.labs.map((l) => LAB_LABEL[l].replace(' Lab', '')).join(' · ')}</td>
                    <td className="mono">{fmt(a.profile_distance, 2)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                        <button className="btn ghost small" onClick={() => go('research', { researchId: a.id })}>Inspect →</button>
                        <button className="btn ghost small" disabled={deletingId === a.id} aria-label={`Delete assessment ${a.id}`}
                                title="Delete assessment" onClick={() => removeAssessment(a)}>
                          {deletingId === a.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
