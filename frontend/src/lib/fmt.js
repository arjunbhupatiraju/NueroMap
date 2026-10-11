export const DOMAIN_COLORS = {
  motor: 'var(--motor)', speech: 'var(--speech)', gait: 'var(--gait)', balance: 'var(--balance)', cognition: 'var(--cognition)',
}
// Hex versions for SVG/Recharts where CSS vars aren't resolved
export const DOMAIN_HEX = { motor: '#3de0ff', speech: '#a67bff', gait: '#5b8cff', balance: '#3dffb0', cognition: '#ff9f5b' }
export const DOMAIN_LABEL = { motor: 'Motor', speech: 'Speech', gait: 'Gait', balance: 'Balance', cognition: 'Cognition' }
export const LAB_DOMAIN = { motor: 'motor', voice: 'speech', gait: 'gait', balance: 'balance', cognitive: 'cognition' }
export const LAB_LABEL = { motor: 'Motor Lab', voice: 'Voice Lab', cognitive: 'Cognitive Lab', gait: 'Gait Lab', balance: 'Balance Lab' }

export function fmt(v, digits) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const a = Math.abs(v)
  const d = digits ?? (a >= 100 ? 0 : a >= 10 ? 1 : 2)
  return v.toFixed(d)
}

export const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export function scoreColor(s) {
  if (s === null || s === undefined) return 'var(--dim)'
  if (s >= 85) return 'var(--good)'
  if (s >= 65) return 'var(--warn)'
  return 'var(--bad)'
}

// Adverse z: positive = moved in the "worse" direction for this feature
export function adverseZ(feature, z) {
  if (z === undefined || z === null || feature?.higher_is_worse === null || feature?.higher_is_worse === undefined) return null
  return feature.higher_is_worse ? z : -z
}

export function zColor(adv) {
  if (adv === null) return 'var(--dim)'
  if (adv > 2) return 'var(--bad)'
  if (adv > 1) return 'var(--warn)'
  return 'var(--good)'
}

export const storage = {
  get(k, d = null) { try { return window.localStorage.getItem(k) ?? d } catch { return d } },
  set(k, v) { try { window.localStorage.setItem(k, v) } catch { /* ignore */ } },
}
