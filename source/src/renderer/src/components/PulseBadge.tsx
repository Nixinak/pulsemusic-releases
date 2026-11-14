// Marks people who use Pulse.
export function PulseBadge({ small = false }: { small?: boolean }): React.JSX.Element {
  return (
    <span className={`pulse-badge ${small ? 'pulse-badge--sm' : ''}`} title="Uses Pulse">
      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 34h11l6-14 9 28 8-20 5 6h13" />
      </svg>
      Pulse
    </span>
  )
}
