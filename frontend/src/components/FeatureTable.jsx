import { DOMAIN_HEX, adverseZ, fmt, zColor } from '../lib/fmt.js'

export default function FeatureTable({ registry, features, z, domain }) {
  const rows = registry.features.filter((f) => features[f.key] !== undefined && (!domain || f.domain === domain))
  if (!rows.length) return null
  return (
    <table className="ftable">
      <thead>
        <tr><th>Feature</th><th style={{ textAlign: 'right' }}>Value</th>{z && <th style={{ textAlign: 'right' }}>vs. baseline</th>}</tr>
      </thead>
      <tbody>
        {rows.map((f) => {
          const zv = z?.[f.key]
          const adv = adverseZ(f, zv)
          return (
            <tr key={f.key} title={f.description}>
              <td><span className="dot" style={{ background: DOMAIN_HEX[f.domain], marginRight: 8 }} />{f.label}</td>
              <td className="num">{fmt(features[f.key])} <span className="dim">{f.unit}</span></td>
              {z && (
                <td className="num">
                  {zv === undefined ? <span className="dim">—</span> : (
                    <span className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                      <span className="zbar"><i style={{
                        left: zv < 0 ? `${50 + Math.max(-50, zv * 12.5)}%` : '50%',
                        width: `${Math.min(50, Math.abs(zv) * 12.5)}%`, background: zColor(adv),
                      }} /></span>
                      <span style={{ color: zColor(adv), minWidth: 44 }}>{zv > 0 ? '+' : ''}{fmt(zv, 1)}</span>
                    </span>
                  )}
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
