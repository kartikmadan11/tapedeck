import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { CONTROL } from '../../lib/ui.js'
import { NAME_LIMIT } from './state.js'

/** Reads as the pane's title until the pointer is near it. */
const NAMEPLATE =
  'h-7 max-w-48 cursor-pointer truncate rounded-xs border border-transparent px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tape-text transition-colors duration-100 hover:border-tape-line focus-visible:border-tape-focus focus-visible:outline-none'

/** Plain text while it is being typed, with none of the nameplate's tracking. */
const BOX = `${CONTROL} w-40 bg-tape-panel`

type Props = {
  /** What the pane is called now, which is its own name or the one its position
   *  gives it. */
  name: string

  /** Empty takes the name back off, which puts the pane on its position's name. */
  onRename: (name: string) => void
}

/**
 * A pane's name, as a title that turns into a box when it is clicked.
 *
 * The draft is held here and nowhere else. A name typed straight into the
 * workspace would re-render every pane in it on every keystroke, the cost the
 * workspace keeps each pane's view in a ref to avoid. As it is, the workspace
 * hears one rename per commit.
 */
export function PaneName({ name, onRename }: Props): ReactElement {
  /** The name being typed, or null while it is only being read. */
  const [draft, setDraft] = useState<string | null>(null)
  const box = useRef<HTMLInputElement>(null)
  const editing = draft !== null

  // Focused on the switch rather than with autoFocus, which cannot tell a mode
  // change from a page load. Selected as well, so replacing a default name
  // outright is one keystroke.
  useEffect(() => {
    if (editing) {
      box.current?.focus()
      box.current?.select()
    }
  }, [editing])

  const commit = (): void => {
    // Unchanged is not a rename, or clicking the name and pressing Enter fixes a
    // default name onto the pane and a shared link carries a name nobody chose.
    if (draft !== null && draft.trim() !== name) {
      onRename(draft.trim())
    }
    setDraft(null)
  }

  if (draft === null) {
    return (
      // Named for what pressing it does, not for what it says: a button whose
      // whole label is "Trades" does not say that it renames anything.
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
      // Committed on the way out as well as on Enter. Escape is the way to leave
      // without committing.
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
