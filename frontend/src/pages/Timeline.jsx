import { useEffect, useState } from 'react'
import {
  CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../lib/api.js'
import { DOMAIN_HEX, DOMAIN_LABEL, adverseZ, fmt, fmtDate } from '../lib/fmt.js'
import NeuroMapViz from '../components/NeuroMapViz.jsx'

const axis = { stroke: '#56617f', tickLine: false, axisLine: { stroke: 'rgba(120,160,255,0.15)' } }
const grid = <CartesianGrid stroke="rgba(120,160,255,0.07)" vertical={false} />

function FeatureChart({ f, data, base }) {
  const color = DOMAIN_HEX[f.domain]
  const pts = data.map((a) => ({ date: fmtDate(a.created_at), v: a.features[f.key], z: a.z[f.key], cal: a.calibrating }))
  if (!pts.some((p) => p.v !== undefined)) return null
  const dot = (props) => {
    const { cx, cy, payload } = props
    if (payload.v === undefined || cx === undefined) return null
    const adv = adverseZ(f, payload.z)
    const fill = payload.cal ? '#56617f' : adv !== null && adv > 2 ? '#ff6b8a' : adv !== null && adv > 1 ? '#ffc85b' : color
    return <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={4} fill={fill} stroke="#070a12" strokeWidth={1.5} />
  }
  return (
    <div className="panel" style={{ padding: 16 }}>
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <h3>{f.label}</h3>
        <span className="dim small mono">{f.unit}</span>
      </div>
      <div className="chart-box short">
        <ResponsiveContainer>
          <LineChart data={pts} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            {grid}
            {base && <ReferenceArea y1={base.median - 2 * base.spread} y2={base.median + 2 * base.spread} fill={color} fillOpacity={0.08} ifOverflow="extendDomain" />}
            {base && <ReferenceLine y={base.median} stroke={color} strokeOpacity={0.4} strokeDasharray="4 4" />}
            <XAxis dataKey="date" {...axis} />
            <YAxis {...axis} domain={['auto', 'auto']} tickFormatter={(v) => fmt(v)} width={56} />
            <Tooltip formatter={(v) => [`${fmt(v)} ${f.unit}`, f.label]} />
            <Line dataKey="v" stroke={color} strokeWidth={2} dot={dot} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="dim small" style={{ margin: '6px 0 0' }}>{f.description}</p>
    </div>
  )
}

export default function Timeline({ registry, profile, focusDomain, go }) {
  const [tl, setTl] = useState(null)
  const [domain, setDomain] = useState(focusDomain ?? 'motor')
  const [snapshotId, setSnapshotId] = useState('')
  const [err, setErr] = useState(null)

  useEffect(() => { if (profile) api.timeline(profile).then(setTl).catch((e) => setErr(e.message)) }, [profile])

  if (!profile) return <div className="panel">Pick a profile on the Profile page first.</div>
  if (err) return <div className="error">{err}</div>
  if (!tl) return <p className="muted">Loading…</p>
  const list = tl.assessments
  if (!list.length) return <div className="panel">No assessments yet. <button className="btn ghost" onClick={() => go('assess')}>Start one →</button></div>

  const snapshot = list.find((assessment) => assessment.id === Number(snapshotId)) ?? list[list.length - 1]
  const scoreData = list.map((a) => ({ date: fmtDate(a.created_at), dist: a.profile_distance, ...a.scores }))
  const feats = registry.features.filter((f) => f.domain === domain)

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <div className="tiny muted">Longitudinal analysis · {profile}</div>
        <h1>Timeline</h1>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Historical NeuroMap</h2>
          <select className="input" value={snapshot.id} onChange={(e) => setSnapshotId(e.target.value)}>
            {list.map((assessment) => (
              <option key={assessment.id} value={assessment.id}>
                {fmtDate(assessment.created_at)} · #{assessment.id}{assessment.synthetic ? ' (synthetic)' : ''}
              </option>
            ))}
          </select>
        </div>
        <NeuroMapViz registry={registry} scores={snapshot.scores} z={snapshot.z}
                     calibrating={snapshot.calibrating} onDomain={setDomain} />
        <div className="row small muted" style={{ justifyContent: 'center', gap: 16 }}>
          {registry.domains.map((d) => (
            <span key={d}><span className="dot" style={{ background: DOMAIN_HEX[d] }} /> {DOMAIN_LABEL[d]} {fmt(snapshot.scores[d], 0)}</span>
          ))}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <div className="panel-head"><h2>Domain scores</h2><span className="tiny dim">100 = your baseline</span></div>
          <div className="chart-box">
            <ResponsiveContainer>
              <LineChart data={scoreData} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                {grid}
                <XAxis dataKey="date" {...axis} />
                <YAxis {...axis} domain={[0, 100]} />
                <Tooltip formatter={(v, k) => [Math.round(v), DOMAIN_LABEL[k]]} />
                {registry.domains.map((d) => (
                  <Line key={d} dataKey={d} stroke={DOMAIN_HEX[d]} strokeWidth={d === domain ? 3 : 1.5}
                        strokeOpacity={d === domain ? 1 : 0.55} dot={false} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Change index</h2><span className="tiny dim">RMS z across all features</span></div>
          <div className="chart-box">
            <ResponsiveContainer>
              <LineChart data={scoreData} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                {grid}
                <ReferenceArea y1={0} y2={1.5} fill="#3dffb0" fillOpacity={0.05} />
                <XAxis dataKey="date" {...axis} />
                <YAxis {...axis} />
                <Tooltip formatter={(v) => [fmt(v, 2), '‖P(t) − P(baseline)‖']} />
                <Line dataKey="dist" stroke="#e6ecff" strokeWidth={2} dot={{ r: 3, fill: '#e6ecff' }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="dim small" style={{ margin: '6px 0 0' }}>
            How far the whole profile has moved from baseline. Shaded band is typical session-to-session noise.
          </p>
        </div>
      </div>

      <div className="tabs">
        {registry.domains.map((d) => (
          <button key={d} className={`tab ${d === domain ? 'active' : ''}`} onClick={() => setDomain(d)}>
            <span className="dot" style={{ background: DOMAIN_HEX[d], marginRight: 6 }} />{DOMAIN_LABEL[d]}
          </button>
        ))}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Dashed line = your baseline median; shaded band = ±2 robust SD. Grey points are baseline sessions; amber and red mark 1–2 and &gt;2 SD changes in the adverse direction.
      </p>
      <div className="grid grid-2">
        {feats.map((f) => <FeatureChart key={f.key} f={f} data={list} base={tl.baseline[f.key]} />)}
      </div>
    </div>
  )
}
