import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { CONTROL } from '../../lib/ui.js'
import { NAME_LIMIT } from './state.js'

/** Reads as the pane's title until the pointer is near it. */
const NAMEPLATE =
  'h-7 max-w-48 cursor-pointer truncate rounded-xs border border-transparent px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tape-text transition-colors duration-100 hover:border-tape-line focus-visible:border-tape-focus focus-visible:outline-none'

/** Plain text while it is being typed, without the nameplate's tracking. */
const BOX = `${CONTROL} w-40 bg-tape-panel`

type Props = {
  /** Its own name, or the one its position gives it. */
  name: string

  /** An empty name takes the name back off, leaving the position's name. */
  onRename: (name: string) => void
}

/** A pane's name, as a title that turns into a box when it is clicked. The draft stays
 *  local: in the workspace it would re-render every pane on every keystroke, so the
 *  workspace hears one rename per commit. */
export function PaneName({ name, onRename }: Props): ReactElement {
  /** The name being typed, or null while it is only being read. */
  const [draft, setDraft] = useState<string | null>(null)
  const box = useRef<HTMLInputElement>(null)
  const editing = draft !== null

  // Not autoFocus, which cannot tell a mode change from a page load. Selected
  // too, so replacing the default name outright is one keystroke.
  useEffect(() => {
    if (editing) {
      box.current?.focus()
      box.current?.select()
    }
  }, [editing])

  const commit = (): void => {
    // Unchanged is not a rename: otherwise click-then-Enter would pin the
    // position's name onto the pane and a shared link would carry it.
    if (draft !== null && draft.trim() !== name) {
      onRename(draft.trim())
    }
    setDraft(null)
  }

  if (draft === null) {
    return (
      // Named for what it does: a button labelled "Trades" does not say it renames.
      <button
        aria-label={`Rename ${name}`}
        className={NAMEPLATE}
        onClick={() => setDraft(name)}
        type="button"
      >
        {name}
      </button>
    )
  }

  return (
    <input
      aria-label={`Rename ${name}`}
      className={BOX}
      maxLength={NAME_LIMIT}
      // Blur commits, as Enter does. Escape is the way out without committing.
      onBlur={commit}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit()
        }
        if (event.key === 'Escape') {
          setDraft(null)
        }
      }}
      ref={box}
      value={draft}
    />
  )
}
