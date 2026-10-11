export default function Logo({ className }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#3de0ff" /><stop offset="0.55" stopColor="#5b8cff" /><stop offset="1" stopColor="#a67bff" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="14.5" stroke="url(#lg)" strokeOpacity="0.5" />
      {[[16, 5], [26, 12], [23, 25], [9, 25], [6, 12]].map(([x, y], i, a) => (
        <g key={i}>
          <line x1="16" y1="16" x2={x} y2={y} stroke="url(#lg)" strokeWidth="1.2" />
          <line x1={x} y1={y} x2={a[(i + 1) % 5][0]} y2={a[(i + 1) % 5][1]} stroke="url(#lg)" strokeOpacity="0.45" />
          <circle cx={x} cy={y} r="2.2" fill="url(#lg)" />
        </g>
      ))}
      <circle cx="16" cy="16" r="3.2" fill="url(#lg)" />
    </svg>
  )
}
