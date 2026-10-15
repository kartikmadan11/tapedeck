import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { TypeaheadOption } from './Typeahead.js'
import { MAX_MATCHES, matchesOf, Typeahead } from './Typeahead.js'

const OPTIONS: TypeaheadOption[] = [
  { value: 'VOD', label: 'Vodafone Group' },
  { value: 'BARC', label: 'Barclays' },
  { value: 'BP', label: 'BP' },
]

function Harness({ onPick }: { onPick?: (value: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <Typeahead
      className=""
      id="symbol"
      label="Symbol"
      name="symbol"
      onChange={setValue}
      onPick={onPick}
      options={OPTIONS}
      value={value}
    />
  )
}

const box = (): HTMLElement => screen.getByRole('combobox')
const shown = (): string[] =>
  screen.queryAllByRole('option').map((option) => option.getAttribute('data-value') ?? '')

describe('matchesOf', () => {
  it('puts a ticker match ahead of a name match', () => {
    expect(matchesOf(OPTIONS, 'b').map((option) => option.value)).toEqual(['BARC', 'BP'])
    expect(matchesOf(OPTIONS, 'fone').map((option) => option.value)).toEqual(['VOD'])
  })

  it('draws no more than the cap, however long the master', () => {
    const many = Array.from({ length: 500 }, (_, index) => ({
      value: `T${index}`,
      label: `Ticker ${index}`,
    }))

    expect(matchesOf(many, '')).toHaveLength(MAX_MATCHES)
  })
})

describe('Typeahead', () => {
  it('narrows the list as it is typed in, and still takes a value it lacks', () => {
    render(<Harness />)

    fireEvent.change(box(), { target: { value: 'B' } })
    expect(shown()).toEqual(['BARC', 'BP'])

    fireEvent.change(box(), { target: { value: 'NOPE' } })
    expect(box()).toHaveValue('NOPE')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('steps the highlight with the arrows and picks on Enter', () => {
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)

    fireEvent.keyDown(box(), { key: 'ArrowDown' })
    expect(box()).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(box(), { key: 'ArrowDown' })

    const active = box().getAttribute('aria-activedescendant')
    expect(document.getElementById(active ?? '')).toHaveAttribute('data-value', 'BARC')

    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(box()).toHaveValue('BARC')
    expect(onPick).toHaveBeenCalledWith('BARC')
    expect(box()).toHaveAttribute('aria-expanded', 'false')
  })

  it('picks on a click, showing the ticker and the name', () => {
    render(<Harness />)
    fireEvent.click(box())

    const vod = screen.getByRole('option', { name: /VOD/ })
    expect(vod).toHaveTextContent('Vodafone Group')
    fireEvent.click(vod)

    expect(box()).toHaveValue('VOD')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes on Escape and on blur, without changing the value', () => {
    render(<Harness />)

    fireEvent.change(box(), { target: { value: 'V' } })
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.click(box())
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.blur(box())
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(box()).toHaveValue('V')
  })
})
