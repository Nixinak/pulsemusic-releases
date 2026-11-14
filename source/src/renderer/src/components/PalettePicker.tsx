// Swatch grid for choosing a background palette: an automatic option, presets, or four custom colours.
import { PRESETS } from '@/lib/colors'

type Four = [string, string, string, string]

function Swatch({
  name,
  colors,
  selected,
  onSelect
}: {
  name: string
  colors: string[] | null
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const bg = colors
    ? `radial-gradient(circle at 20% 20%, ${colors[0]}, transparent 60%), radial-gradient(circle at 85% 30%, ${colors[1]}, transparent 60%), radial-gradient(circle at 30% 90%, ${colors[2]}, transparent 60%), ${colors[3]}`
    : 'conic-gradient(from 200deg, #ff4f8b, #ffb347, #7cf29c, #2ad1c9, #4a5cff, #b03cff, #ff4f8b)'
  return (
    <button role="radio" aria-checked={selected} className={`swatch ${selected ? 'is-on' : ''}`} onClick={onSelect}>
      <span className="swatch__chip" style={{ background: bg }} />
      <span className="swatch__name">{name}</span>
    </button>
  )
}

export function PalettePicker({
  value,
  autoId,
  autoLabel,
  customColors,
  onChange,
  onCustomColors
}: {
  value: string
  autoId: string
  autoLabel: string
  customColors: Four
  onChange: (v: string) => void
  onCustomColors: (c: Four) => void
}): React.JSX.Element {
  return (
    <>
      <div className="palettes" role="radiogroup" aria-label="Colour palette">
        <Swatch name={autoLabel} colors={null} selected={value === autoId} onSelect={() => onChange(autoId)} />
        {PRESETS.map((p) => (
          <Swatch key={p.id} name={p.name} colors={p.colors} selected={value === p.id} onSelect={() => onChange(p.id)} />
        ))}
        <Swatch name="Custom" colors={customColors} selected={value === 'custom'} onSelect={() => onChange('custom')} />
      </div>
      {value === 'custom' && (
        <div className="custom-colors">
          {customColors.map((c, i) => (
            <label key={i} className="color-pick">
              <input
                type="color"
                value={c}
                onChange={(e) => {
                  const next = [...customColors] as Four
                  next[i] = e.target.value
                  onCustomColors(next)
                }}
              />
              <span>{c.toUpperCase()}</span>
            </label>
          ))}
        </div>
      )}
    </>
  )
}

/** Resolves a picker value to colours (null for the automatic option). */
export function resolveColors(value: string, custom: Four): Four | null {
  if (value === 'custom') return custom
  return PRESETS.find((p) => p.id === value)?.colors ?? null
}
