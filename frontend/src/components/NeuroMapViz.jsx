import { DOMAIN_HEX, DOMAIN_LABEL } from '../lib/fmt.js'

const W = 520, H = 430, CX = W / 2, CY = H / 2 + 6, R = 150

export default function NeuroMapViz({ registry, scores = {}, z = {}, onDomain, onCenter, calibrating }) {
  const domains = registry.domains
  return (
    <div className="map-wrap">
      <svg viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <radialGradient id="core" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#5b8cff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#5b8cff" stopOpacity="0" />
          </radialGradient>
          {domains.map((d) => (
            <radialGradient key={d} id={`glow-${d}`} cx="50%" cy="50%" r="50%">
              <stop offset="0" stopColor={DOMAIN_HEX[d]} stopOpacity="0.35" />
              <stop offset="1" stopColor={DOMAIN_HEX[d]} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>

        {/* concentric guide rings */}
        {[60, 110, R, R + 55].map((r) => (
          <circle key={r} cx={CX} cy={CY} r={r} fill="none" stroke="#5b8cff" strokeOpacity="0.07" />
        ))}

        {domains.map((d, i) => {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / domains.length
          const hx = CX + R * Math.cos(a), hy = CY + R * Math.sin(a)
          const nx = CX + R * Math.cos(a + (2 * Math.PI) / domains.length)
          const ny = CY + R * Math.sin(a + (2 * Math.PI) / domains.length)
          const feats = registry.features.filter((f) => f.domain === d)
          const score = scores[d]
          const col = DOMAIN_HEX[d]
          const ringR = 27
          const circ = 2 * Math.PI * ringR
          const frac = score === null || score === undefined ? 0 : score / 100

          const labelInset = 54 + (Math.abs(Math.cos(a)) > 0.7 ? 18 : 0)
          const labelX = hx - labelInset * Math.cos(a)
          const labelY = hy - labelInset * Math.sin(a) + 4

          return (
            <g key={d}>
              <line x1={hx} y1={hy} x2={nx} y2={ny} stroke="#5b8cff" strokeOpacity="0.12" />
              <line className="map-link" x1={CX} y1={CY} x2={hx} y2={hy} stroke={col} strokeOpacity="0.55" strokeWidth="1.3" />

              {/* feature satellites */}
              {feats.map((f, j) => {
                const spread = 0.95
                const fa = a + (feats.length === 1 ? 0 : (j / (feats.length - 1) - 0.5) * spread * 2)
                const sr = 50
                const sx = hx + sr * Math.cos(fa), sy = hy + sr * Math.sin(fa)
                return (
                  <g key={f.key}>
                    <line x1={hx} y1={hy} x2={sx} y2={sy} stroke={col} strokeOpacity="0.25" />
                    <circle cx={sx} cy={sy} r="4" fill={z[f.key] === undefined ? '#1b2440' : col}
                            stroke={col} strokeOpacity="0.5">
                      <title>{f.label}{z[f.key] !== undefined ? ` · z = ${z[f.key].toFixed(2)}` : ''}</title>
                    </circle>
                  </g>
                )
              })}

              {/* hub */}
              <g role={onDomain ? 'button' : undefined} tabIndex={onDomain ? 0 : undefined}
                 aria-label={onDomain ? `Open ${DOMAIN_LABEL[d]} breakdown` : undefined}
                 style={{ cursor: onDomain ? 'pointer' : 'default' }} onClick={() => onDomain?.(d)}
                 onKeyDown={(event) => {
                   if (onDomain && (event.key === 'Enter' || event.key === ' ')) {
                     event.preventDefault()
                     onDomain(d)
                   }
                 }}>
                <circle cx={hx} cy={hy} r="46" fill={`url(#glow-${d})`} />
                <circle cx={hx} cy={hy} r={ringR} fill="#0b1122" stroke={col} strokeOpacity="0.25" strokeWidth="3" />
                <circle cx={hx} cy={hy} r={ringR} fill="none" stroke={col} strokeWidth="3" strokeLinecap="round"
                        strokeDasharray={`${circ * frac} ${circ}`} transform={`rotate(-90 ${hx} ${hy})`}
                        style={{ transition: 'stroke-dasharray .8s ease' }} />
                <text x={hx} y={hy + 5} textAnchor="middle" fill="#e6ecff" fontFamily="JetBrains Mono" fontSize="14">
                  {score === null || score === undefined ? (calibrating ? '···' : '—') : Math.round(score)}
                </text>
                <text x={labelX} y={labelY} textAnchor="middle" fill={col}
                      fontSize="11" letterSpacing="2" fontFamily="Space Grotesk" fontWeight="600">
                  {DOMAIN_LABEL[d].toUpperCase()}
                </text>
              </g>
            </g>
          )
        })}

          <g role={onCenter ? 'button' : undefined} tabIndex={onCenter ? 0 : undefined}
            aria-label={onCenter ? 'Open NeuroMap Stability Index' : undefined}
            style={{ cursor: onCenter ? 'pointer' : 'default' }} onClick={() => onCenter?.()}
           onKeyDown={(event) => {
             if (event.key === 'Enter' || event.key === ' ') {
               event.preventDefault()
               onCenter?.()
             }
           }}>
          <title>Open NeuroMap Stability Index</title>
          <circle cx={CX} cy={CY} r="46" fill="url(#core)" className="map-core" />
          <circle cx={CX} cy={CY} r="16" fill="none" stroke="#e6ecff" strokeOpacity="0.3" />
          <circle cx={CX} cy={CY} r="9" fill="#e6ecff" />
          <text x={CX} y={CY + 34} textAnchor="middle" fill="#e6ecff" fontSize="8" fontFamily="JetBrains Mono">
            INDEX
          </text>
        </g>
      </svg>
    </div>
  )
}
