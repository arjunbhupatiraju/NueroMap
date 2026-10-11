import { useCallback, useEffect, useState } from 'react'
import { api } from './lib/api.js'
import { storage } from './lib/fmt.js'
import Dashboard from './pages/Dashboard.jsx'
import Assessment from './pages/Assessment.jsx'
import Timeline from './pages/Timeline.jsx'
import Research from './pages/Research.jsx'
import Report from './pages/Report.jsx'
import Logo from './components/Logo.jsx'

const PAGES = [
  ['dashboard', 'Profile'],
  ['assess', 'New assessment'],
  ['timeline', 'Timeline'],
  ['research', 'Research mode'],
  ['report', 'Report'],
]
const DEMO_PROFILE = 'Demo (synthetic)'

export default function App() {
  const [registry, setRegistry] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [profile, setProfileState] = useState(storage.get('neuromap.profile', ''))
  const [page, setPage] = useState('dashboard')
  const [researchId, setResearchId] = useState(null)
  const [focusDomain, setFocusDomain] = useState(null)
  const [error, setError] = useState(null)

  const setProfile = (p) => { setProfileState(p); storage.set('neuromap.profile', p) }

  const refreshProfiles = useCallback(async () => {
    try {
      const ps = await api.profiles()
      setProfiles(ps)
      return ps
    } catch (e) { setError(e.message); return [] }
  }, [])

  useEffect(() => {
    api.registry().then(setRegistry).catch((e) => setError(`Can't reach the NeuroMap backend (${e.message}). Is it running on port 8000?`))
    refreshProfiles().then((ps) => {
      if (!storage.get('neuromap.profile', '') && ps.some((p) => p.profile === DEMO_PROFILE)) {
        setProfile(DEMO_PROFILE)
      }
    })
  }, [refreshProfiles])

  const go = (p, opts = {}) => {
    if (opts.researchId !== undefined) setResearchId(opts.researchId)
    setFocusDomain(opts.domain ?? null)
    setPage(p)
    window.scrollTo({ top: 0 })
  }

  const ctx = { registry, profiles, profile, setProfile, refreshProfiles, go, focusDomain, researchId }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => go('dashboard')}>
          <Logo className="brand-mark" />
          <span className="brand-name">NEUROMAP</span>
        </div>
        <nav className="nav">
          {PAGES.map(([k, label]) => (
            <button key={k} className={page === k ? 'active' : ''} onClick={() => go(k)}>{label}</button>
          ))}
        </nav>
        <div className="spacer" />
        {profile && <span className="chip"><span className="dot" style={{ background: 'var(--cyan)' }} />{profile}</span>}
      </header>

      {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}

      {registry && page === 'dashboard' && <Dashboard {...ctx} />}
      {registry && page === 'assess' && <Assessment {...ctx} />}
      {registry && page === 'timeline' && <Timeline {...ctx} />}
      {registry && page === 'research' && <Research {...ctx} />}
      {registry && page === 'report' && <Report {...ctx} />}

      <footer className="footer">
        NeuroMap is an experimental personal project. It measures changes relative to your own baseline and is not a medical device or diagnostic tool.
      </footer>
    </div>
  )
}
