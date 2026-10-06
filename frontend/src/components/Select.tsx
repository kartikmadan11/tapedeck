import type { KeyboardEvent, ReactElement } from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type SelectOption = { value: string; label: string }

type Props = {
  /** Names the control and the list under it, which are one thing to a reader. */
  label: string
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  /** Carries the fill, which the caller states per the note in lib/ui.ts. */
  className: string
  disabled?: boolean | undefined
  id?: string | undefined
}

/** Clear of the control, so the list does not sit on the box it came out of. */
const GAP = 2

/** Keeps the list off the edge when the control is near one. */
const PAD = 4

/** Where the list is, which is also whether it is open: one piece of state
 *  rather than a flag and a position that can disagree. */
type Box = { left: number; top: number; minWidth: number }

/**
 * A select whose list is ours to draw.
 *
 * A native `select` renders its popup outside the page, so `option` takes a
 * colour at the browser's discretion and nothing else: not the font, not the row
 * height, not the border. On a terminal palette that popup is the one surface
 * that looks like somebody else's application, which is the whole reason this
 * exists. It is the ARIA select-only combobox: focus stays on the button and
 * `aria-activedescendant` says which row the keys are on.
 */
export function Select({
  label,
  value,
  options,
  onChange,
  className,
  disabled,
  id,
}: Props): ReactElement {
  const trigger = useRef<HTMLButtonElement>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const rows = useRef<(HTMLDivElement | null)[]>([])
  const listId = useId()

  const [box, setBox] = useState<Box | null>(null)
  const open = box !== null

  /** Which row the keys are on while the list is up. Not the selection: moving
   *  through a list does not change the value until it is taken. */
  const [active, setActive] = useState(0)

  const chosen = options.findIndex((option) => option.value === value)

  const show = (): void => {
    const anchor = trigger.current?.getBoundingClientRect()
    if (anchor === undefined) {
      return
    }
    // Opens on the current value, so the keys start where the eye is.
    setActive(Math.max(0, chosen))
    setBox({ left: anchor.left, top: anchor.bottom + GAP, minWidth: anchor.width })
  }

  const commit = (index: number): void => {
    const option = options[index]
    setBox(null)
    trigger.current?.focus()
    if (option !== undefined && option.value !== value) {
      onChange(option.value)
    }
  }

  // Placed under the control and corrected once, rather than measured before it
  // is drawn: the first position is already right in every case but the one this
  // fixes, a list opened from the bottom of the ticket with no room beneath it.
  // jsdom reports no height, which is the case this leaves where it put it.
  useLayoutEffect(() => {
    if (box === null) {
      return
    }
    const list = sheet.current?.getBoundingClientRect()
    const anchor = trigger.current?.getBoundingClientRect()
    if (list === undefined || anchor === undefined || list.height === 0) {
      return
    }
    const left = Math.max(PAD, Math.min(box.left, window.innerWidth - list.width - PAD))
    const top =
      list.bottom <= window.innerHeight - PAD
        ? box.top
        : Math.max(PAD, anchor.top - list.height - GAP)
    if (left !== box.left || top !== box.top) {
      setBox({ ...box, left, top })
    }
  }, [box])

  // Through the rows rather than the window, so walking a twelve-line instrument
  // master with the keys brings each line into the list's own scroll.
  useEffect(() => {
    rows.current[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  useEffect(() => {
    if (!open) {
      return
    }
    const close = (): void => setBox(null)
    const outside = (event: Event): void => {
      const target = event.target
      if (
        target instanceof Node &&
        (sheet.current?.contains(target) === true || trigger.current?.contains(target) === true)
      ) {
        return
      }
      close()
    }

    // Capture on scroll, because what scrolls is the panel the control sits in
    // rather than the page: a list left behind would point at a box that moved.
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!open) {
      // Enter and Space are the button's own activation, which opens it already.
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        show()
      }
      return
    }

    // Let focus leave, and take the list with it. Everything else below is the
    // list's, so none of it reaches the grid behind the control.
    if (event.key === 'Tab') {
      setBox(null)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) {
      return
    }
    // Including Enter and Space: without this the button's activation would fire
    // a click as well and close the list over the top of the commit.
    event.preventDefault()

    if (event.key === 'Escape') {
      setBox(null)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      commit(active)
      return
    }
    if (event.key === 'Home') {
      setActive(0)
      return
    }
    if (event.key === 'End') {
      setActive(options.length - 1)
      return
    }
    const step = event.key === 'ArrowDown' ? 1 : -1
    setActive((from) => Math.min(options.length - 1, Math.max(0, from + step)))
  }

  return (
    <>
      <button
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className={`flex cursor-pointer items-center justify-between gap-1 text-left ${className}`}
        // The value, for a test and for anyone reading the DOM to find out what
        // a control is actually holding. A button has none of its own.
        data-value={value}
        disabled={disabled}
        id={id}
        onClick={() => (open ? setBox(null) : show())}
        onKeyDown={onKeyDown}
        ref={trigger}
        role="combobox"
        type="button"
      >
        {/* truncate, so a long counterparty shortens rather than widening the
            control and pushing the row it sits in onto a second line. */}
        <span className="truncate">{options[chosen]?.label ?? ''}</span>
        <span aria-hidden="true" className="shrink-0 text-tape-muted">
          ▾
        </span>
      </button>

      {/* Portaled, because every one of these sits inside something that clips:
        a scrolling config panel, a pane, the window. */}
      {box === null
        ? null
        : createPortal(
            <div
              aria-label={label}
              className="tape-scroll fixed z-50 max-h-64 overflow-y-auto rounded-xs border border-tape-line bg-tape-panel py-1 shadow-lg"
              id={listId}
              // Keeps focus on the button, which is where the keys are bound and
              // where it has to return to when the list closes.
              onMouseDown={(event) => event.preventDefault()}
              ref={sheet}
              role="listbox"
              style={{ left: box.left, top: box.top, minWidth: box.minWidth }}
            >
              {options.map((option, index) => (
                // biome-ignore lint/a11y/useFocusableInteractive: focus stays on the combobox and aria-activedescendant names the row, which is the ARIA pattern. A focusable option would take focus off the element the keys are bound to.
                // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard route is the combobox's own keydown, for the same reason.
                <div
                  aria-selected={option.value === value}
                  className={`cursor-pointer whitespace-nowrap px-2 ${
                    index === active ? 'bg-tape-raised' : ''
                  } ${option.value === value ? 'text-tape-accent' : 'text-tape-text'}`}
                  data-value={option.value}
                  id={`${listId}-${index}`}
                  key={option.value}
                  onClick={() => commit(index)}
                  // Follows the pointer, so a click never lands on a row other
                  // than the one under it.
                  onMouseEnter={() => setActive(index)}
                  ref={(node) => {
                    rows.current[index] = node
                  }}
                  role="option"
                >
                  {/* A fixed cell for the tick, which a monospace face lines up
                      for free, so the labels do not shift as the value moves. */}
                  <span aria-hidden="true" className="inline-block w-3">
                    {option.value === value ? '✓' : ''}
                  </span>
                  {option.label}
                </div>
              ))}
            </div>,
            document.body,
          )}
    </>
  )
}
