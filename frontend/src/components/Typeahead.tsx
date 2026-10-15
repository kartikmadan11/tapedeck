import type { ChangeEvent, KeyboardEvent, ReactElement, Ref } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Chevron, GAP, LISTBOX, optionClass } from './Select.js'

export type TypeaheadOption = { value: string; label: string }

type Props = {
  id: string
  name: string
  label: string
  value: string
  options: readonly TypeaheadOption[]
  /** Every edit, typed or picked: the box stays free text. */
  onChange: (value: string) => void
  /** A pick from the list only, which fires no input event of its own. */
  onPick?: ((value: string) => void) | undefined
  onBlur?: (() => void) | undefined
  /** Carries the fill, which the caller states per the note in lib/ui.ts. */
  className: string
  ref?: Ref<HTMLInputElement> | undefined
}

/** A real master holds thousands of lines, so the list draws only the head of the
 *  matches. Typing narrows it faster than scrolling would. */
export const MAX_MATCHES = 50

/** Ticker first, then name: someone who knows the code types the code. */
export function matchesOf(options: readonly TypeaheadOption[], query: string): TypeaheadOption[] {
  const typed = query.trim().toUpperCase()
  if (typed === '') {
    return options.slice(0, MAX_MATCHES)
  }
  const byCode = options.filter((option) => option.value.toUpperCase().startsWith(typed))
  const byName = options.filter(
    (option) =>
      !option.value.toUpperCase().startsWith(typed) && option.label.toUpperCase().includes(typed),
  )
  return [...byCode, ...byName].slice(0, MAX_MATCHES)
}

type Box = { left: number; top: number; minWidth: number }

/** A text box with a list under it, drawn here rather than by a datalist, whose
 *  popup the browser paints in its own colours. ARIA editable combobox with list
 *  autocomplete: focus stays in the box and aria-activedescendant names the row. */
export function Typeahead({
  id,
  name,
  label,
  value,
  options,
  onChange,
  onPick,
  onBlur,
  className,
  ref,
}: Props): ReactElement {
  const box = useRef<HTMLInputElement | null>(null)
  const listId = useId()
  const [at, setAt] = useState<Box | null>(null)
  const [active, setActive] = useState(-1)
  const open = at !== null

  const matches = open ? matchesOf(options, value) : []

  const show = (): void => {
    const anchor = box.current?.getBoundingClientRect()
    if (anchor !== undefined) {
      setAt({ left: anchor.left, top: anchor.bottom + GAP, minWidth: anchor.width })
    }
  }
  const hide = (): void => {
    setAt(null)
    setActive(-1)
  }

  const pick = (option: TypeaheadOption): void => {
    onChange(option.value)
    onPick?.(option.value)
    hide()
  }

  // Fixed to where the box was, so a scroll or resize would strand it.
  useEffect(() => {
    if (!open) {
      return
    }
    const close = (): void => {
      setAt(null)
      setActive(-1)
    }
    document.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        show()
        setActive(0)
        return
      }
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((from) => Math.min(matches.length - 1, Math.max(0, from + step)))
      return
    }
    if (!open) {
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      hide()
      return
    }
    // Only with a row under the keys: otherwise Enter is the form's, and books.
    const highlighted = matches[active]
    if (event.key === 'Enter' && highlighted !== undefined) {
      event.preventDefault()
      pick(highlighted)
      return
    }
    if (event.key === 'Tab') {
      hide()
    }
  }

  return (
    <div className="relative">
      <input
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        autoComplete="off"
        className={`${className} pr-6`}
        id={id}
        name={name}
        onBlur={() => {
          hide()
          onBlur?.()
        }}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onChange(event.target.value)
          show()
          setActive(-1)
        }}
        onClick={() => (open ? hide() : show())}
        onKeyDown={onKeyDown}
        ref={(node) => {
          box.current = node
          if (typeof ref === 'function') {
            ref(node)
          } else if (ref) {
            ref.current = node
          }
        }}
        role="combobox"
        value={value}
      />
      <Chevron className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2" />

      {/* Portaled, as the Select's is: the ticket sits inside panels that clip. */}
      {at === null || matches.length === 0
        ? null
        : createPortal(
            <div
              aria-label={label}
              className={LISTBOX}
              id={listId}
              // Keeps focus in the box, so a click does not blur and close first.
              onMouseDown={(event) => event.preventDefault()}
              role="listbox"
              style={{ left: at.left, top: at.top, minWidth: at.minWidth }}
            >
              {matches.map((option, index) => (
                // biome-ignore lint/a11y/useFocusableInteractive: focus stays in the combobox and aria-activedescendant names the row, which is the ARIA pattern.
                // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard route is the combobox's own keydown, for the same reason.
                <div
                  aria-selected={index === active}
                  className={`py-0.5 ${optionClass(index === active, option.value === value)}`}
                  data-value={option.value}
                  id={`${listId}-${index}`}
                  key={option.value}
                  onClick={() => pick(option)}
                  onMouseEnter={() => setActive(index)}
                  role="option"
                >
                  <span className="block font-semibold">{option.value}</span>
                  <span className="block text-[10px] text-tape-muted">{option.label}</span>
                </div>
              ))}
            </div>,
            document.body,
          )}
    </div>
  )
}
