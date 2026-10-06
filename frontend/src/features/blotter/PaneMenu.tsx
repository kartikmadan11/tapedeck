import type { KeyboardEvent, ReactElement } from 'react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** Where the menu was asked for, in viewport coordinates. */
export type Point = { x: number; y: number }

export type MenuItem = {
  label: string
  onSelect: () => void
  /** Refused, never left out: the list is the same every time it opens, so no
   *  item moves under a pointer going on muscle memory. */
  disabled?: boolean | undefined
  /** Draws a rule above this item. */
  separated?: boolean | undefined
  /** The key that does the same from the grid. Announced through
   *  aria-keyshortcuts, so it stays out of the item's name. */
  keys?: string | undefined
  /** For an item that opens something and leaves it open after the menu closes. */
  expanded?: boolean | undefined
  controls?: string | undefined
}

type Props = {
  /** Names the menu: the pane it belongs to. */
  label: string
  at: Point
  items: readonly MenuItem[]
  /** Must be stable: it is a dependency of the listeners that close the menu. */
  onDismiss: () => void
}

/** Clear of the pointer, so the first item is not already under it. */
const OFFSET = 2

/** Keeps the sheet off the edge when it is opened near one. */
const PAD = 4

/** A pane's own context menu: a portaled sheet with a roving tabindex. */
export function PaneMenu({ label, at, items, onDismiss }: Props): ReactElement {
  const sheet = useRef<HTMLDivElement>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const [point, setPoint] = useState<Point>(at)

  /** Which item the arrow keys are on: a roving tabindex, so a hover does not
   *  lose the keyboard's place. */
  const [active, setActive] = useState(() => firstEnabled(items))

  // Must come before the effect that takes focus, or this reads the menu itself
  // rather than whatever had focus before it opened.
  useEffect(() => {
    const opener = document.activeElement
    return () => {
      if (opener instanceof HTMLElement) {
        opener.focus()
      }
    }
  }, [])

  useEffect(() => {
    buttons.current[active]?.focus()
  }, [active])

  // Measured, since the sheet's height is its item count: a menu opened near an
  // edge would otherwise run off it. Width 0 is jsdom, which has no layout.
  useLayoutEffect(() => {
    const box = sheet.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0) {
      return
    }
    setPoint({
      x: Math.max(PAD, Math.min(at.x + OFFSET, window.innerWidth - box.width - PAD)),
      y: Math.max(PAD, Math.min(at.y + OFFSET, window.innerHeight - box.height - PAD)),
    })
  }, [at])

  useEffect(() => {
    const outside = (event: Event): void => {
      if (event.target instanceof Node && sheet.current?.contains(event.target) === true) {
        return
      }
      onDismiss()
    }

    // Capture on scroll: what scrolls is the pane's tape, not the page, and a
    // menu left behind would point at a row that has moved.
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('scroll', onDismiss, true)
    window.addEventListener('resize', onDismiss)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('scroll', onDismiss, true)
      window.removeEventListener('resize', onDismiss)
    }
  }, [onDismiss])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const handled = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'Tab']
    if (!handled.includes(event.key)) {
      return
    }
    // Including Tab: a menu that let focus leave would stay open over whatever
    // took it, and arrow keys must not scroll the tape behind the sheet.
    event.preventDefault()

    if (event.key === 'Escape' || event.key === 'Tab') {
      onDismiss()
      return
    }
    if (event.key === 'Home') {
      setActive(firstEnabled(items))
      return
    }
    if (event.key === 'End') {
      setActive(step(items, 0, -1))
      return
    }
    setActive((from) => step(items, from, event.key === 'ArrowDown' ? 1 : -1))
  }

  // Portaled to the body: a pane sits inside two levels of overflow-hidden,
  // which would clip the sheet.
  return createPortal(
    <div
      className="fixed z-40 min-w-44 rounded-xs border border-tape-line bg-tape-panel py-1 shadow-lg"
      ref={sheet}
      style={{ left: point.x, top: point.y }}
    >
      <div aria-label={label} onKeyDown={onKeyDown} role="menu">
        {items.map((item, index) => (
          <Fragment key={item.label}>
            {item.separated === true ? <div className="my-1 border-t border-tape-line" /> : null}
            <button
              aria-controls={item.controls}
              aria-expanded={item.expanded}
              aria-keyshortcuts={item.keys}
              className="flex w-full cursor-pointer items-baseline gap-4 px-3 py-1 text-left text-tape-text hover:bg-tape-raised disabled:cursor-not-allowed disabled:text-tape-muted disabled:opacity-40 disabled:hover:bg-transparent"
              disabled={item.disabled === true}
              onClick={() => {
                item.onSelect()
                onDismiss()
              }}
              ref={(node) => {
                buttons.current[index] = node
              }}
              role="menuitem"
              tabIndex={index === active ? 0 : -1}
              type="button"
            >
              {item.label}
              {/* aria-hidden: aria-keyshortcuts above already announces it. */}
              {item.keys === undefined ? null : (
                <span aria-hidden="true" className="ml-auto text-tape-accent">
                  {item.keys}
                </span>
              )}
            </button>
          </Fragment>
        ))}
      </div>
    </div>,
    document.body,
  )
}

/** The first item that can be chosen, so a menu never opens on a refused one. */
function firstEnabled(items: readonly MenuItem[]): number {
  return step(items, -1, 1)
}

/** The next choosable item in a direction, wrapping at either end. */
function step(items: readonly MenuItem[], from: number, direction: number): number {
  for (let moved = 1; moved <= items.length; moved += 1) {
    const index = (((from + direction * moved) % items.length) + items.length) % items.length
    if (items[index]?.disabled !== true) {
      return index
    }
  }
  return from
}
