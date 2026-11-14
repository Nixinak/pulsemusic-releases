import { useEffect, useRef } from 'react'
import { useApp, currentRoute } from '@/lib/store'
import { Glass } from './Glass'
import { ChevronLeft, ChevronRight, CloseIcon, SearchIcon } from './Icons'

export function TopBar(): React.JSX.Element {
  const back = useApp((s) => s.back)
  const forward = useApp((s) => s.forward)
  const canBack = useApp((s) => s.index > 0)
  const canForward = useApp((s) => s.index < s.history.length - 1)
  const route = useApp(currentRoute)
  const navigate = useApp((s) => s.navigate)
  const query = useApp((s) => s.searchQuery)
  const setQuery = useApp((s) => s.setSearchQuery)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <header className="topbar">
      <div className="topbar__nav">
        <Glass radius={999} bezel={10} refraction={30} blur={8} className="topbar__pill">
          <button className="icon-btn" aria-label="Back" disabled={!canBack} onClick={back}>
            <ChevronLeft size={20} />
          </button>
          <button className="icon-btn" aria-label="Forward" disabled={!canForward} onClick={forward}>
            <ChevronRight size={20} />
          </button>
        </Glass>
        <Glass
          radius={999}
          bezel={12}
          refraction={36}
          blur={8}
          className={`search-pill ${route.name === 'search' || query ? 'is-open' : ''}`}
        >
          <button className="search-pill__icon" aria-label="Search" tabIndex={-1} onClick={() => input.current?.focus()}>
            <SearchIcon size={18} />
          </button>
          <input
            ref={input}
            value={query}
            aria-label="Search"
            spellCheck={false}
            onFocus={() => route.name !== 'search' && navigate({ name: 'search' })}
            onChange={(e) => {
              setQuery(e.target.value)
              if (route.name !== 'search') navigate({ name: 'search' })
            }}
            onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLInputElement).blur()}
          />
          {query && (
            <button className="icon-btn icon-btn--sm" aria-label="Clear search" onClick={() => setQuery('')}>
              <CloseIcon size={15} />
            </button>
          )}
        </Glass>
      </div>
    </header>
  )
}
