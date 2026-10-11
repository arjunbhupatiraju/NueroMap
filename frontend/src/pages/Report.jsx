import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { DOMAIN_HEX, DOMAIN_LABEL, adverseZ, fmt, fmtDate, scoreColor } from '../lib/fmt.js'

const DEMO_PROFILE = 'Demo (synthetic)'
const DEMO_LABS = ['motor', 'voice', 'cognitive', 'gait', 'balance']
const DOMAIN_MEASURES = {
  motor: 'Finger-tap speed and rhythm',
  speech: 'Pauses, pitch, and vocal variation',
  gait: 'Walking cadence and step timing',
  balance: 'Standing sway and movement',
  cognition: 'Reaction time and digit-span task',
}

function average(values) {
  const usable = values.filter(Number.isFinite)
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null
}

function makeFindings(assessments, latest, registry) {
  if (!latest) return []
  if (!assessments.some((assessment) => !assessment.calibrating)) {
    return [{
      label: 'Baseline in progress',
      text: 'More scored assessments are needed before recurring signals and domain changes can be summarized.',
      tone: 'neutral',
    }]
  }

  const findings = []
  const domainRows = registry.domains
    .map((domain) => ({ domain, score: latest.scores?.[domain], delta: (latest.scores?.[domain] ?? 100) - 100 }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score)

  if (domainRows.length && domainRows[0].delta < -5) {
    const primary = domainRows[0]
    findings.push({
      label: 'Largest domain deviation',
      text: `${DOMAIN_LABEL[primary.domain]} is ${fmt(Math.abs(primary.delta), 0)} index points below baseline. This is the largest measured shift, not a percent loss of ability or a measure of medical seriousness.`,
      tone: 'warn',
    })
  }

  const recent = assessments.filter((assessment) => !assessment.calibrating).slice(-4)
  const featureRows = registry.features.map((feature) => {
    const count = recent.filter((assessment) => {
      const z = assessment.z?.[feature.key]
      const adverse = adverseZ(feature, z)
      return adverse !== null && adverse > 1
    }).length
    const latestAdverse = adverseZ(feature, latest.z?.[feature.key])
    return { feature, count, total: recent.length, latestAdverse }
  }).filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || (b.latestAdverse ?? 0) - (a.latestAdverse ?? 0))

  for (const item of featureRows.slice(0, 3)) {
    findings.push({
      label: item.count >= 3 ? 'Recurring feature shift' : 'Emerging feature shift',
      text: `${item.feature.label} (${DOMAIN_LABEL[item.feature.domain]}) moved more than 1 SD from baseline in the direction the scoring system flags, in ${item.count} of the last ${item.total} scored assessments.`,
      tone: item.count >= 3 ? 'warn' : 'neutral',
    })
  }

  if (!findings.length) {
    findings.push({ label: 'No prominent findings', text: 'No recurring feature shift above the report threshold was found. This does not mean every measurement was identical to baseline.', tone: 'good' })
  }
  return findings
}

function makeTimelineEvents(assessments, changePoints, registry) {
  if (!assessments.length) return []
  const events = []
  const windowSize = Math.min(6, assessments.length)
  events.push({
    date: `Sessions 1–${windowSize}`,
    title: 'Personal reference period',
    detail: `NeuroMap estimates your personal reference from up to your first six sessions. Scores appear after the baseline has enough data.`,
  })

  for (const point of changePoints) {
    const index = assessments.findIndex((assessment) => assessment.id === point.assessment_id)
    const assessment = assessments[index]
    events.push({
      date: assessment ? `Session ${index + 1} · ${fmtDate(assessment.created_at)}` : point.created_at ? fmtDate(point.created_at) : 'Detected shift',
      title: `Possible ${DOMAIN_LABEL[point.domain]} change point`,
      detail: `The domain score level ${point.delta < 0 ? 'dropped' : 'rose'} by ${fmt(Math.abs(point.delta), 1)} points versus earlier sessions. This flags a possible shift between assessments; it does not identify the cause or exact start date.`,
      tone: 'warn',
    })
  }

  const latest = assessments[assessments.length - 1]
  events.push({
    date: `Session ${assessments.length} · ${fmtDate(latest.created_at)}`,
    title: 'Most recent assessment',
    detail: 'Latest available measurements compared with your personal reference period.',
  })
  return events
}

export default function Report({ profile, registry, go }) {
  const [timeline, setTimeline] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let current = true
    setTimeline(null)
    setError(null)
    if (profile) api.timeline(profile).then((data) => {
      if (current) setTimeline(data)
    }).catch((err) => {
      if (current) setError(err.message)
    })
    return () => { current = false }
  }, [profile])

  if (!profile) return <div className="panel stack"><h1>Report</h1><p className="muted">Choose or create a profile before generating its report.</p><button className="btn primary" onClick={() => go('dashboard')}>Open profile</button></div>
  if (error) return <div className="error">Could not load this report: {error}</div>
  if (!timeline) return <p className="muted">Preparing report…</p>

  const allAssessments = timeline.assessments ?? []
  const assessments = profile === DEMO_PROFILE
    ? allAssessments.filter((assessment) => DEMO_LABS.every((lab) => assessment.labs.includes(lab)))
    : allAssessments
  const scored = assessments.filter((assessment) => !assessment.calibrating && registry.domains.every((domain) => Number.isFinite(assessment.scores?.[domain])))
  const latest = scored[scored.length - 1] ?? assessments[assessments.length - 1]

  if (!latest) return <div className="panel stack"><h1>Report</h1><p className="muted">No assessments have been recorded for this profile yet.</p><button className="btn primary" onClick={() => go('assess')}>Start assessment</button></div>

  const changePoints = (timeline.change_points ?? []).filter((point) => assessments.some((assessment) => assessment.id === point.assessment_id))
  const status = changePoints.length ? 'Significant Change Detected' : scored.length >= 5 ? 'No Large Shift Detected' : 'Baseline Building'
  const domainRows = registry.domains.map((domain) => ({
    domain,
    score: latest.scores?.[domain],
    delta: Number.isFinite(latest.scores?.[domain]) ? latest.scores[domain] - 100 : null,
  }))
  const ranked = domainRows.filter((item) => item.delta !== null).sort((a, b) => a.delta - b.delta)
  const mainDeviation = ranked[0]
  const secondaryDeviation = ranked[1]
  const otherRows = ranked.filter((item) => item !== mainDeviation && item !== secondaryDeviation)
  const closerDomains = otherRows.map((item) => DOMAIN_LABEL[item.domain].toLowerCase())
  const closerText = closerDomains.length > 1
    ? `${closerDomains.slice(0, -1).join(', ')}, and ${closerDomains[closerDomains.length - 1]}`
    : closerDomains[0]
  const summary = latest.calibrating
    ? `The personal baseline is still being established. ${assessments.length} assessment${assessments.length === 1 ? '' : 's'} recorded so far; domain comparisons will become more informative as scored history accumulates.`
    : mainDeviation
    ? `${DOMAIN_LABEL[mainDeviation.domain]} showed the largest deviation at ${fmt(Math.abs(mainDeviation.delta), 0)} points below its personal baseline.` +
      (secondaryDeviation && secondaryDeviation.delta < -5
        ? ` ${DOMAIN_LABEL[secondaryDeviation.domain]} also shifted ${fmt(Math.abs(secondaryDeviation.delta), 0)} points below baseline.`
        : '') +
      (closerText ? ` Other domain scores for ${closerText} remained closer to baseline in this assessment.` : '')
    : 'There are not yet enough scored measurements to compare this profile with its personal baseline.'
  const findings = makeFindings(scored, latest, registry)
  const events = makeTimelineEvents(assessments, changePoints, registry)

  return (
    <div className="stack report-page" style={{ gap: 16 }}>
      <div>
        <div className="tiny muted">Longitudinal summary · {profile}</div>
        <h1>Report</h1>
        <p className="muted report-intro">This report shows which measured tasks changed compared with your own starting pattern. It cannot identify a cause or determine medical seriousness.</p>
      </div>

      <section className="panel report-executive" aria-labelledby="executive-summary">
        <div className="tiny muted">Section 1 · Executive Summary</div>
        <div className={`report-status ${changePoints.length ? 'changed' : 'steady'}`}>
          <div className="tiny muted">Overall profile status</div>
          <h2 id="executive-summary">{status}</h2>
          <p>{summary}</p>
          <p className="report-meaning">
            {changePoints.length
              ? 'Here, “significant” means NeuroMap’s exploratory rule found a possible shift in domain scores. It is not a statement about disease, danger, or medical seriousness.'
              : scored.length >= 5
                ? 'No domain-level shift crossed NeuroMap’s exploratory detection rule. That does not mean every measurement was unchanged or rule out changes the app cannot measure.'
                : 'There are not enough scored sessions to look for a domain-level shift yet.'}
          </p>
        </div>
        <div className="report-explainer">
          <strong>How to read these scores</strong>
          <p>100 is the reference level estimated from your first sessions. A lower number means the measured features moved farther in directions the scoring system flags as changes from your own baseline. The difference is in index points, not a percentage or a direct measure of ability.</p>
        </div>
        <div className="report-comparison" role="table" aria-label="Current scores compared with personal baseline">
          <div className="report-comparison-row report-comparison-head" role="row">
            <span role="columnheader">Domain</span><span role="columnheader">Current</span><span role="columnheader">Baseline</span><span role="columnheader">Change</span>
          </div>
          {domainRows.map((item) => (
            <div className="report-comparison-row" role="row" key={item.domain}>
              <div className="report-domain-cell" role="cell">
                <strong style={{ color: DOMAIN_HEX[item.domain] }}>{DOMAIN_LABEL[item.domain]}</strong>
                <span>{DOMAIN_MEASURES[item.domain]}</span>
              </div>
              <span className="mono" style={{ color: scoreColor(item.score) }} role="cell">{fmt(item.score, 0)}</span>
              <span className="mono muted" role="cell">100</span>
              <span className="mono" style={{ color: item.delta !== null && item.delta < -10 ? 'var(--warn)' : 'var(--muted)' }} role="cell">
                {item.delta === null ? '—' : `${item.delta > 0 ? '+' : ''}${fmt(item.delta, 0)}`}
              </span>
            </div>
          ))}
        </div>
        <p className="muted small report-note">The table shows which measured domains are farthest from your own reference period. It cannot explain why they changed.</p>
      </section>

      <section className="panel" aria-labelledby="key-findings">
        <div className="tiny muted">Section 2 · Key Findings</div>
        <h2 id="key-findings" style={{ marginTop: 4 }}>Most significant findings</h2>
        <p className="muted small report-section-help">Findings are ordered to highlight the largest domain difference and repeated feature shifts. One standard deviation (SD) is a measure of how much baseline readings varied; more than 1 SD means a reading moved beyond that usual spread in the flagged direction. This is a comparison threshold, not a medical cutoff. Counts show how often it happened in recent scored sessions.</p>
        <div className="report-findings">
          {findings.map((finding, index) => (
            <article className={`report-finding ${finding.tone}`} key={`${finding.label}-${index}`}>
              <div className="tiny muted">{finding.label}</div>
              <p>{finding.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel" aria-labelledby="timeline-narrative">
        <div className="tiny muted">Section 3 · Timeline Narrative</div>
        <h2 id="timeline-narrative" style={{ marginTop: 4 }}>How the profile evolved</h2>
        <p className="muted small report-section-help">Events summarize when the app first detected a pattern in an assessment. They do not tell when a real-world change began, and small or gradual changes may not trigger an event.</p>
        {events.length ? (
          <ol className="report-events">
            {events.map((event, index) => (
              <li className={event.tone === 'warn' ? 'changed' : ''} key={`${event.title}-${index}`}>
                <span className="report-event-date">{event.date}</span>
                <strong>{event.title}</strong>
                <p>{event.detail}</p>
              </li>
            ))}
          </ol>
        ) : <p className="muted">Timeline events will appear as assessments are recorded.</p>}
      </section>

      <p className="muted small report-disclaimer">NeuroMap describes changes from a personal baseline. It does not diagnose conditions or predict disease.</p>
    </div>
  )
}