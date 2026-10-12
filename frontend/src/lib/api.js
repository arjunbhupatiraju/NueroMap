async function req(path, opts = {}) {
  const res = await fetch(`/api${path}`, opts)
  let body = null
  try { body = await res.json() } catch { /* empty */ }
  if (!res.ok) {
    const msg = body?.detail ? (typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)) : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return body
}

const json = (method, data) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })

export const api = {
  registry: () => req('/registry'),
  profiles: () => req('/profiles'),
  deleteProfile: (p) => req(`/profiles/${encodeURIComponent(p)}`, { method: 'DELETE' }),
  timeline: (p) => req(`/profiles/${encodeURIComponent(p)}/timeline`),
  newAssessment: (profile) => req('/assessments', json('POST', { profile })),
  assessment: (id) => req(`/assessments/${id}`),
  deleteAssessment: (id) => req(`/assessments/${id}`, { method: 'DELETE' }),
  submitLab: (id, lab, raw) => req(`/assessments/${id}/labs/${lab}`, json('POST', raw)),
  submitVoice: (id, wavBlob, passageWords) => {
    const fd = new FormData()
    fd.append('file', wavBlob, 'voice.wav')
    fd.append('passage_words', String(passageWords))
    return req(`/assessments/${id}/labs/voice`, { method: 'POST', body: fd })
  },
  seedDemo: () => req('/demo/seed', { method: 'POST' }),
  voiceModel: () => req('/research/voice-model'),
  voiceModelPerson: (n) => req(`/research/voice-model/people/${n}`),
}
