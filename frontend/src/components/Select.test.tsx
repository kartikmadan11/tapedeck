import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectOption } from './Select.js'
import { Select } from './Select.js'

/** Four, so stepping off either end is testable. Labels unlike their values, so
 *  a test cannot pass by reading the wrong one. */
const OPTIONS: SelectOption[] = [
  { value: 'BARC', label: 'Barclays' },
  { value: 'VOD', label: 'Vodafone' },
  { value: 'HSBA', label: 'HSBC' },
  { value: 'LLOY', label: 'Lloyds' },
]

const taken = vi.fn()

/** State is held here rather than mocked, so a test sees what a commit leaves on
 *  screen as well as what it reported. */
function Harness(): ReactElement {
  const [value, setValue] = useState('VOD')
  return (
    <Select
      className="w-24"
      label="Symbol"
      onChange={(next) => {
        taken(next)
        setValue(next)
      }}
      options={OPTIONS}
      value={value}
    />
  )
}

const control = (): HTMLElement => screen.getByRole('combobox', { name: 'Symbol' })

const list = (): HTMLElement => screen.getByRole('listbox', { name: 'Symbol' })

/** One row of the open list, by the value it carries rather than by its label. */
function row(value: string): HTMLElement {
  const found = list().querySelector(`[role="option"][data-value="${value}"]`)
  if (!(found instanceof HTMLElement)) {
    throw new Error(`no row for ${value}`)
  }
  return found
}

/** The row the keys are on, which the control names rather than focuses. */
function onKeys(): string | null {
  const id = control().getAttribute('aria-activedescendant')
  return document.getElementById(id ?? '')?.getAttribute('data-value') ?? null
}

function open(): void {
  fireEvent.click(control())
}

function press(key: string): void {
  fireEvent.keyDown(control(), { key })
}

beforeEach(() => taken.mockClear())

describe('a select whose list is ours to draw', () => {
  it('says what it is holding, with nothing in the way until it is asked', () => {
    render(<Harness />)

    expect(control()).toHaveTextContent('Vodafone')
    expect(control()).toHaveAttribute('data-value', 'VOD')
    expect(control()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('names the list after the control, and points at it only while it is up', () => {
    render(<Harness />)
    expect(control()).not.toHaveAttribute('aria-controls')

    open()
    expect(control()).toHaveAttribute('aria-controls', list().id)
    // On the body rather than in the control's own tree: every one of these sits
    // inside something that clips, starting with the scrolling config panel.
    expect(list().parentElement).toBe(document.body)
  })

  it('opens on the value it holds, so the keys start where the eye is', () => {
    render(<Harness />)
    open()

    expect(onKeys()).toBe('VOD')
    expect(within(list()).getByRole('option', { selected: true })).toHaveAttribute(
      'data-value',
      'VOD',
    )
  })

  it('takes a row on a press and closes behind it', () => {
    render(<Harness />)
    open()
    fireEvent.click(row('HSBA'))

    expect(taken).toHaveBeenCalledWith('HSBA')
    expect(control()).toHaveTextContent('HSBC')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('reports nothing when the row taken is the row already held', () => {
    render(<Harness />)
    open()
    fireEvent.click(row('VOD'))

    // A filter re-set to what it already was would rebuild the row model for no
    // change, which on a live tape is a frame of work nobody asked for.
    expect(taken).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('steps the keys through the rows and takes the one they land on', () => {
    render(<Harness />)
    open()

    press('ArrowDown')
    expect(onKeys()).toBe('HSBA')
    press('Enter')
    expect(taken).toHaveBeenCalledWith('HSBA')
  })

  it('stops at both ends rather than wrapping round', () => {
    render(<Harness />)
    open()

    // Wrapping would send a held arrow key from the last line back to the first,
    // past the row the hand was aiming at.
    press('Home')
    expect(onKeys()).toBe('BARC')
    press('ArrowUp')
    expect(onKeys()).toBe('BARC')

    press('End')
    expect(onKeys()).toBe('LLOY')
    press('ArrowDown')
    expect(onKeys()).toBe('LLOY')
  })

  it('opens from the keys as well as from the pointer', () => {
    render(<Harness />)
    press('ArrowDown')

    expect(list()).toBeInTheDocument()
    expect(onKeys()).toBe('VOD')
  })

  it('follows the pointer, so a press lands on the row under it', () => {
    render(<Harness />)
    open()
    fireEvent.mouseEnter(row('LLOY'))

    expect(onKeys()).toBe('LLOY')
  })

  it('leaves the value alone on Escape', () => {
    render(<Harness />)
    open()
    press('ArrowDown')
    press('Escape')

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(control()).toHaveAttribute('data-value', 'VOD')
    expect(taken).not.toHaveBeenCalled()
  })

  it('lets Tab out, and takes the list with it', () => {
    render(<Harness />)
    open()
    press('Tab')

    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes on a press outside, since the list is not in the page it covers', () => {
    render(<Harness />)
    open()
    fireEvent.pointerDown(document.body)

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(taken).not.toHaveBeenCalled()
  })

  it('puts focus back on the control, which is where the keys are bound', () => {
    render(<Harness />)
    control().focus()
    open()
    fireEvent.click(row('HSBA'))

    expect(control()).toHaveFocus()
  })
})
