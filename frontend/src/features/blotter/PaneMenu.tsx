import type { KeyboardEvent, ReactElement } from 'react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** Where the menu was asked for, in viewport coordinates. */
export type Point = { x: number; y: number }

export type MenuItem = {
  label: string
  onSelect: () => void
  /**
   * Refused rather than left out, so the menu is the same list every time it
   * opens and no item moves under a pointer going on muscle memory.
   */
  disabled?: boolean | undefined
  /** Draws a rule above this item, which is all the grouping the list needs. */
  separated?: boolean | undefined
  /**
   * For an item that opens something and leaves it open: the panel still has to
   * be announced as open, which a plain menu item cannot say.
   */
  expanded?: boolean | undefined
  controls?: string | undefined
}

type Props = {
  /** Names the menu, which is the pane it belongs to. */
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

/**
 * A pane's own controls, on the pane rather than on its bar.
 *
 * Shift falls through to the browser's own menu, which is the convention on a
 * grid that takes over right-click, and the reason the sheet says so.
 */
export function PaneMenu({ label, at, items, onDismiss }: Props): ReactElement {
  const sheet = useRef<HTMLDivElement>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const [point, setPoint] = useState<Point>(at)

  /**
   * Which item the arrow keys are on, as a roving tabindex rather than as focus
   * following the pointer, which would lose the keyboard's place on every hover.
   */
  const [active, setActive] = useState(() => firstEnabled(items))

  // Declared before the effect that takes focus, so what it reads is whatever
  // had focus before the menu opened rather than the menu itself.
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

  // Measured rather than guessed, because the sheet's height is the number of
  // items and a menu opened near the bottom of the window would otherwise run
  // off it. jsdom reports no width, which is the one case this leaves alone.
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

    // Capture on scroll, because what scrolls is the pane's own tape rather than
    // the page: a menu left behind would be pointing at a row that has moved.
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

  // Portaled to the body, because a pane is a flex item inside two levels of
  // overflow-hidden and a sheet drawn inside one would be clipped by it.
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
              className="block w-full cursor-pointer px-3 py-1 text-left text-tape-text hover:bg-tape-raised disabled:cursor-not-allowed disabled:text-tape-muted disabled:opacity-40 disabled:hover:bg-transparent"
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
            </button>
          </Fragment>
        ))}
      </div>
    </div>,
    document.body,
  )
}

/** The first item that can be chosen, so a menu never opens with focus on a
 *  refused one. */
function firstEnabled(items: readonly MenuItem[]): number {
  return step(items, -1, 1)
}

/**
 * The next item in a direction, skipping what cannot be chosen and wrapping at
 * either end.
 */
function step(items: readonly MenuItem[], from: number, direction: number): number {
  for (let moved = 1; moved <= items.length; moved += 1) {
    const index = (((from + direction * moved) % items.length) + items.length) % items.length
    if (items[index]?.disabled !== true) {
      return index
    }
  }
  return from
}
