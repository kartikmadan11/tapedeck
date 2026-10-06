import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { CHIP, CONTROL } from '../../lib/ui.js'
import { NAME_LIMIT } from './state.js'

/** Wide enough for the prompt rather than for a name. */
const BOX = `${CONTROL} w-44 bg-tape-panel`

type Props = {
  /** Empty opens a pane with no name of its own, which leaves it named by where
   *  the workspace puts it. */
  onOpen: (name: string) => void
}

/**
 * Opens a pane, named, from the nav rather than from a pane. Duplicate is the
 * other way in and hands over the view in front of it; this one opens empty.
 */
export function NewPane({ onOpen }: Props): ReactElement {
  /** The name being typed, or null while the control is just a chip. */
  const [draft, setDraft] = useState<string | null>(null)
  const box = useRef<HTMLInputElement>(null)
  const naming = draft !== null

  // Focused on the switch rather than with autoFocus, which cannot tell a mode
  // change from a page load.
  useEffect(() => {
    if (naming) {
      box.current?.focus()
    }
  }, [naming])

  if (draft === null) {
    return (
      <button className={CHIP} onClick={() => setDraft('')} type="button">
        New pane
      </button>
    )
  }

  return (
    <input
      aria-label="Name for the new pane"
      className={BOX}
      maxLength={NAME_LIMIT}
      // Abandoned on the way out rather than opened, which is the opposite of
      // what blur does to a rename: opening a pane rearranges the workspace, so
      // it takes Enter.
      onBlur={() => setDraft(null)}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          // Empty is a pane and no name. Trimmed, because a name of spaces is
          // not a name.
          onOpen(draft.trim())
          setDraft(null)
        }
        if (event.key === 'Escape') {
          setDraft(null)
        }
      }}
      placeholder="Name, then Enter"
      ref={box}
      value={draft}
    />
  )
}
