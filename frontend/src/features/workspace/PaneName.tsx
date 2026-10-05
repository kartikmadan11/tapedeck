import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { CONTROL } from '../../lib/ui.js'
import { NAME_LIMIT } from './state.js'

/**
 * Reads as the pane's title until the pointer is near it, which is what a name
 * should look like when nobody is changing it. The brightest and largest thing
 * on the bar, and the only one not in the muted grey the chrome uses.
 */
const NAMEPLATE =
  'h-7 max-w-48 cursor-pointer truncate rounded-xs border border-transparent px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tape-text transition-colors duration-100 hover:border-tape-line focus-visible:border-tape-focus focus-visible:outline-none'

/** Plain text while it is being typed, with none of the nameplate's tracking: a
 *  box you type into should show what you typed. */
const BOX = `${CONTROL} w-40 bg-tape-panel`

type Props = {
  /** What the pane is called now, which is its own name or the one its position
   *  gives it. */
  name: string

  /** Empty takes the name back off, which puts the pane on its position's name. */
  onRename: (name: string) => void
}

/**
 * A pane's name, and the way it is changed.
 *
 * A title that turns into a box when it is clicked, rather than a box that always
 * looks like one. The bar it sits on already carries five filter inputs, and a
 * sixth would read as a filter on something.
 *
 * The draft is held here and nowhere else, which is the point. A name typed
 * straight into the workspace would re-render every pane in it on every
 * keystroke, the cost the workspace keeps each pane's view in a ref to avoid. As
 * it is, the workspace hears one rename per commit.
 */
export function PaneName({ name, onRename }: Props): ReactElement {
  /** The name being typed, or null while it is only being read. */
  const [draft, setDraft] = useState<string | null>(null)
  const box = useRef<HTMLInputElement>(null)
  const editing = draft !== null

  // Focused on the switch rather than with autoFocus, which cannot tell a mode
  // change from a page load. Selected as well, so the commonest rename of all,
  // replacing a default name outright, is one keystroke.
  useEffect(() => {
    if (editing) {
      box.current?.focus()
      box.current?.select()
    }
  }, [editing])

  const commit = (): void => {
    // Unchanged is not a rename. Clicking the name and pressing Enter would
    // otherwise fix a default name onto the pane, and a shared link would then
    // have to carry a name nobody chose.
    if (draft !== null && draft.trim() !== name) {
      onRename(draft.trim())
    }
    setDraft(null)
  }

  if (draft === null) {
    return (
      // Named for what pressing it does, not for what it says: the name is the
      // visible text either way, and a button whose whole label is "Trades" does
      // not say that it renames anything.
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
      // Committed on the way out as well as on Enter, because a trader who types
      // a name and clicks back into the tape has said what they wanted. Escape
      // is the way to leave without saying it.
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
