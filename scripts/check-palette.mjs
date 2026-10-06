// Every colour in a .tsx comes from a tape-* token, so restyling is one file.
// Node rather than a grep one-liner, because npm run check has to run on Windows.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = 'frontend/src'

/** The Tailwind palettes the tokens replaced, plus any hex literal. */
const RAW_COLOUR = /zinc-|indigo-|emerald-|rose-|#[0-9a-fA-F]{6}/

const entries = await readdir(ROOT, { recursive: true, withFileTypes: true })
const offences = []

for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith('.tsx')) continue

  const path = join(entry.parentPath, entry.name)
  const lines = (await readFile(path, 'utf8')).split('\n')

  for (const [index, line] of lines.entries()) {
    if (RAW_COLOUR.test(line)) offences.push(`${path}:${index + 1}: ${line.trim()}`)
  }
}

if (offences.length > 0) {
  console.error(offences.join('\n'))
  console.error('palette: use a tape-* token, not a raw colour')
  process.exit(1)
}
