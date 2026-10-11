import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../lib/api.js'
import { DOMAIN_HEX, DOMAIN_LABEL, LAB_DOMAIN, LAB_LABEL, adverseZ, fmt, fmtDate, scoreColor } from '../lib/fmt.js'
import FeatureTable from '../components/FeatureTable.jsx'

const axis = { stroke: '#56617f', tickLine: false, axisLine: { stroke: 'rgba(120,160,255,0.15)' } }

// Generic signal plot: a line (x[], y[]) plus optional marker points and shaded x-ranges
function Signal({ x, y, color, points, areas, xLabel = 's', height, yDomain, refY, square }) {
  const data = useMemo(() => x.map((xv, i) => ({ x: xv, y: y[i] })), [x, y])
  const pts = points ? points.x.map((xv, i) => ({ x: xv, p: points.y[i] })) : null
  return (
    <div className="chart-box" style={{ height: height ?? 220, maxWidth: square ? 360 : undefined }}>
      <ResponsiveContainer>
        <ComposedChart margin={{ top: 6, right: 10, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="rgba(120,160,255,0.07)" vertical={false} />
          {areas?.map(([a, b], i) => <ReferenceArea key={i} x1={a} x2={b} fill="#ff6b8a" fillOpacity={0.12} />)}
          {refY !== undefined && <ReferenceLine y={refY} stroke="#56617f" strokeDasharray="4 4" />}
          <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} {...axis} tickFormatter={(v) => `${fmt(v, 1)}${xLabel}`} allowDuplicatedCategory={false} />
          <YAxis {...axis} domain={yDomain ?? ['auto', 'auto']} tickFormatter={(v) => fmt(v)} width={52} />
          <Tooltip formatter={(v) => fmt(v, 3)} labelFormatter={(v) => `${fmt(v, 2)} ${xLabel}`} />
          <Line data={data} dataKey="y" stroke={color} dot={false} strokeWidth={1.6} isAnimationActive={false} connectNulls={false} />
          {pts && <Scatter data={pts} dataKey="p" fill="#ff6b8a" isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function Stage({ n, title, children, text }) {
  return (
    <div className="pstage">
      <div className="pstage-num">{n}</div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children}
    </div>
  )
}

function Stats({ items }) {
  return (
    <div className="row" style={{ gap: 18 }}>
      {items.map(([k, v]) => (
        <div key={k}><div className="tiny dim">{k}</div><div className="mono">{v}</div></div>
      ))}
    </div>
  )
}

function MotorPipeline({ trace }) {
  const hands = Object.keys(trace)
  const [hand, setHand] = useState(hands.includes('right') ? 'right' : hands[0])
  const t = trace[hand]
  const c = DOMAIN_HEX.motor
  return (
    <>
      {hands.length > 1 && (
        <div className="tabs" style={{ marginLeft: 46, marginBottom: 8 }}>
          {hands.map((h) => <button key={h} className={`tab ${h === hand ? 'active' : ''}`} onClick={() => setHand(h)}>{h} hand</button>)}
        </div>
      )}
      <Stage n="1" title="Camera → hand landmarks"
             text="MediaPipe Hand Landmarker finds 21 points on the hand in every video frame. Only four are kept: thumb tip, index tip, wrist and the base of the middle finger. The video itself is never stored.">
        <div className="code">{`frame { t: 1532.4 ms,  thumb: [612, 288],  index: [640, 201],  wrist: [655, 470],  middle_mcp: [648, 352] }`}</div>
      </Stage>
      <Stage n="2" title="Landmarks → aperture signal"
             text="Thumb–index distance divided by hand size (wrist to middle-finger base), so moving closer to the camera doesn't change the value. Frames are resampled onto an even 60 Hz grid. Red points are detected taps: peaks with enough prominence, at least 100 ms apart.">
        <Signal x={t.t_s} y={t.aperture} color={c} points={{ x: t.peak_t_s, y: t.peak_amp }} />
      </Stage>
      <Stage n="3" title="Taps → rhythm and amplitude"
             text="Inter-tap intervals show rhythm consistency. The slope of peak amplitude across taps measures the sequence effect: movements that shrink as the trial goes on.">
        <div className="grid grid-2">
          <Signal x={t.intervals_ms.map((_, i) => i + 1)} y={t.intervals_ms} color={c} xLabel="" height={170} />
          <Signal x={t.peak_amp.map((_, i) => i + 1)} y={t.peak_amp} color="#a67bff" xLabel="" height={170} />
        </div>
        <div className="row small dim" style={{ gap: 24 }}><span>← interval (ms) per tap</span><span>← peak amplitude per tap</span></div>
      </Stage>
    </>
  )
}

function VoicePipeline({ trace }) {
  const c = DOMAIN_HEX.speech
  const f0 = trace.f0_hz.map((v) => (v === null ? null : v))
  return (
    <>
      <Stage n="1" title="Waveform → loudness envelope"
             text="The 16 kHz recording is cut into 25 ms frames every 10 ms. Each frame's RMS energy in decibels gives the loudness envelope. An adaptive threshold (12 dB above the noise floor) separates speech from silence. Red bands are pauses longer than 150 ms.">
        <Signal x={trace.t_s} y={trace.db} color={c} areas={trace.pauses} />
      </Stage>
      <Stage n="2" title="Voiced frames → pitch track"
             text="For each voiced frame, autocorrelation finds the repeating period of the vocal folds, and F0 = sample rate / lag. Octave errors (jumps of more than 7 semitones) are rejected.">
        <Signal x={trace.f0_t_s} y={f0} color="#3de0ff" />
      </Stage>
    </>
  )
}

function GaitPipeline({ trace }) {
  return (
    <>
      <Stage n="1" title="Raw accelerometer"
             text="Magnitude of the raw 3-axis acceleration, including gravity (≈ 9.8 m/s²). The phone can be in any orientation.">
        <Signal x={trace.t_s} y={trace.raw_mag} color="#56617f" refY={9.81} height={170} />
      </Stage>
      <Stage n="2" title="Remove gravity → vertical motion → steps"
             text="A 0.3 Hz low-pass filter estimates the gravity vector, which defines 'vertical'. Linear acceleration is projected onto it and band-passed to 0.5–3 Hz. Each peak (red) is a step.">
        <Signal x={trace.t_s} y={trace.vertical} color={DOMAIN_HEX.gait} points={{ x: trace.step_t_s, y: trace.step_amp }} />
      </Stage>
      <Stage n="3" title="Periodicity"
             text="Autocorrelation of the vertical signal. The height of the peak at one step period measures how regular the gait is (1.0 would be perfectly periodic).">
        <Signal x={trace.autocorr_lag_s} y={trace.autocorr} color="#a67bff" height={170} refY={0} />
      </Stage>
    </>
  )
}

function BalancePipeline({ trace }) {
  return (
    <>
      <Stage n="1" title="Horizontal sway over time"
             text="With gravity removed, the horizontal component of acceleration (band-passed 0.1–5 Hz) captures small corrective movements while standing still.">
        <Signal x={trace.t_s} y={trace.sway_mag} color={DOMAIN_HEX.balance} height={170} />
      </Stage>
      <Stage n="2" title="Sway path"
             text="The same signal projected onto its two main horizontal axes, like a stabilogram from a force plate.">
        <Signal x={trace.sway_x} y={trace.sway_y} color={DOMAIN_HEX.balance} xLabel="" square height={300} />
      </Stage>
    </>
  )
}

function CognitivePipeline({ trace }) {
  return (
    <>
      <Stage n="1" title="Reaction-time distribution"
             text="RT = t(response) − t(stimulus), timed with performance.now(). Beyond the mean: median, variability, lapses (> 500 ms), and learning across trials (the slope).">
        {trace.rt_ms && (
          <>
            <Signal x={trace.rt_ms.map((_, i) => i + 1)} y={trace.rt_ms} color={DOMAIN_HEX.cognition} xLabel="" refY={500} height={190} />
            <Stats items={[
              ['mean', `${fmt(trace.rt_mean_ms, 0)} ms`], ['sd', `${fmt(trace.rt_sd_ms, 0)} ms`],
              ['learning slope', `${fmt(trace.learning_slope_ms_per_trial, 1)} ms/trial`], ['outliers removed', trace.outliers_removed],
            ]} />
          </>
        )}
      </Stage>
      <Stage n="2" title="Working memory span">
        {trace.span_trials && (
          <div className="row">
            {trace.span_trials.map((s, i) => (
              <span key={i} className={`chip ${s.correct ? 'good' : 'bad'}`}>{s.length} digits {s.correct ? '✓' : '✗'}</span>
            ))}
          </div>
        )}
      </Stage>
    </>
  )
}

const PIPES = { motor: MotorPipeline, voice: VoicePipeline, gait: GaitPipeline, balance: BalancePipeline, cognitive: CognitivePipeline }

export default function Research({ registry, profile, researchId, go }) {
  const [tl, setTl] = useState(null)
  const [aid, setAid] = useState(researchId)
  const [detail, setDetail] = useState(null)
  const [lab, setLab] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!profile) return
    api.timeline(profile).then((t) => {
      setTl(t)
      if (!aid && t.assessments.length) setAid(t.assessments[t.assessments.length - 1].id)
    }).catch((e) => setErr(e.message))
  }, [profile]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!aid) return
    setDetail(null)
    api.assessment(aid).then((d) => {
      setDetail(d)
      setLab((cur) => (cur && d.labs[cur] ? cur : ['motor', 'voice', 'cognitive', 'gait', 'balance'].find((l) => d.labs[l])))
    }).catch((e) => setErr(e.message))
  }, [aid])

  if (!profile) return <div className="panel">Pick a profile on the Profile page first.</div>
  if (err) return <div className="error">{err}</div>
  if (tl && !tl.assessments.length) return <div className="panel">No assessments yet. <button className="btn ghost" onClick={() => go('assess')}>Start one →</button></div>

  const Pipe = lab && PIPES[lab]
  const res = detail?.labs?.[lab]
  const score = detail?.score
  const domain = LAB_DOMAIN[lab]
  const scoreableFeatures = res && score?.z
    ? registry.features.filter((f) => f.domain === domain && f.higher_is_worse !== null && Number.isFinite(score.z[f.key]))
    : []
  const featureImpacts = scoreableFeatures
    .map((f) => ({
      feature: f,
      points: Math.max(0, Math.min(5, adverseZ(f, score.z[f.key]))) * 15 / Math.max(1, scoreableFeatures.length),
    }))
    .filter((item) => item.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="tiny muted">Research mode · {profile}</div>
          <h1>Signal → features → profile</h1>
        </div>
        {tl && (
          <select className="input" value={aid ?? ''} onChange={(e) => setAid(Number(e.target.value))}>
            {[...tl.assessments].reverse().map((a) => (
              <option key={a.id} value={a.id}>{fmtDate(a.created_at)} · #{a.id}{a.synthetic ? ' (synthetic)' : ''}</option>
            ))}
          </select>
        )}
      </div>

      {detail && (
        <div className="tabs">
          {Object.keys(LAB_LABEL).filter((l) => detail.labs[l]).map((l) => (
            <button key={l} className={`tab ${l === lab ? 'active' : ''}`} onClick={() => setLab(l)}>
              <span className="dot" style={{ background: DOMAIN_HEX[LAB_DOMAIN[l]], marginRight: 6 }} />{LAB_LABEL[l]}
            </button>
          ))}
        </div>
      )}

      {!detail && <p className="muted">Loading…</p>}
      {detail?.synthetic ? <div className="notice">This assessment was generated from synthetic signals (demo profile), run through the same pipelines as real recordings.</div> : null}

      {res && Pipe && (
        <div className="panel pipeline">
          <Pipe key={`${aid}-${lab}`} trace={res.trace} />
          <Stage n="→" title="Features"
                 text="Each pipeline reduces its signal to a few interpretable numbers. The right-hand column compares them with this person's own baseline (robust z-score: median and MAD of the baseline sessions).">
            <FeatureTable registry={registry} features={res.features} z={score?.z} domain={domain} />
            {!score?.calibrating && scoreableFeatures.length > 0 && (
              <div style={{ marginTop: 12, maxWidth: 620 }}>
                <div className="tiny dim">Largest contributors to this score reduction</div>
                {featureImpacts.length ? featureImpacts.map(({ feature, points }) => (
                  <div className="row small" key={feature.key} style={{ justifyContent: 'space-between', marginTop: 5 }}>
                    <span>{feature.label}</span><span className="mono" style={{ color: 'var(--bad)' }}>−{fmt(points, 1)} pts</span>
                  </div>
                )) : <p className="muted small" style={{ margin: '5px 0 0' }}>No adverse feature changes are reducing this score.</p>}
                <p className="dim small" style={{ margin: '6px 0 0' }}>Contribution is calculated from adverse z-scores and the scoring formula.</p>
              </div>
            )}
          </Stage>
          <Stage n="◎" title={`Into the profile: ${DOMAIN_LABEL[domain]}`}
                 text="Adverse z-scores in a domain are averaged (capped at 5) and mapped to a 0–100 score, where 100 means 'at your baseline'. The five domain scores together form the NeuroMap.">
            {score?.calibrating
              ? <span className="chip">baseline session: no score yet</span>
              : (
                <div className="row" style={{ gap: 24 }}>
                  {registry.domains.map((d) => (
                    <div key={d} style={{ opacity: d === domain ? 1 : 0.45 }}>
                      <div className="tiny" style={{ color: DOMAIN_HEX[d] }}>{DOMAIN_LABEL[d]}</div>
                      <div className="mono" style={{ fontSize: 22, color: scoreColor(score?.scores?.[d]) }}>
                        {score?.scores?.[d] === null || score?.scores?.[d] === undefined ? '—' : Math.round(score.scores[d])}
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </Stage>
        </div>
      )}
    </div>
  )
}
