/**
 * Read the colour at the edge of the logo and write it into the stylesheet.
 *
 * The sign-in page is painted --brand-canvas and the logo's outer edge is
 * feathered into it. That only looks like one surface if the two colours match;
 * a near miss reads as a halo, which is more noticeable than no feather at all.
 * Eyeballing a hex from a gradient is exactly the kind of "close enough" that
 * isn't, so this measures it.
 *
 * Samples the outermost ring of pixels, ignores anything transparent, and takes
 * the median rather than the mean so a bright corner artefact cannot drag the
 * result. Run it whenever the logo changes:
 *
 *   npm run brand:sample
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Jimp } from 'jimp'

const DIR = 'public/brand'
const CSS = 'src/index.css'
const RING = 0.02 // sample the outer 2% of the image

const file = readdirSync(DIR).find((f) => /\.(png|jpe?g|bmp|gif)$/i.test(f))
if (!file) {
  console.error(`No image found in ${DIR}/. Save the logo there as logo.png and run again.`)
  process.exit(1)
}

const img = await Jimp.read(join(DIR, file))
const { width: w, height: h } = img.bitmap
const band = Math.max(1, Math.round(Math.min(w, h) * RING))

// Read the raw RGBA buffer rather than a helper: it is four bytes per pixel in
// every Jimp version, so this cannot break on a library upgrade.
const px = img.bitmap.data
const reds = [], greens = [], blues = []
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const onEdge = x < band || y < band || x >= w - band || y >= h - band
    if (!onEdge) continue
    const i = (y * w + x) * 4
    if (px[i + 3] < 250) continue // transparent edges have no colour to match
    reds.push(px[i]); greens.push(px[i + 1]); blues.push(px[i + 2])
  }
}

if (reds.length === 0) {
  console.error('The edge of this image is transparent, so there is nothing to match.')
  console.error('A logo on a transparent background needs no canvas colour — use the page default.')
  process.exit(1)
}

const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const hex = '#' + [median(reds), median(greens), median(blues)]
  .map((n) => n.toString(16).padStart(2, '0')).join('')

// Light or dark ground decides the ink that sits on it.
const [r, g, b] = [median(reds), median(greens), median(blues)]
const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
const ink = luminance > 0.5 ? '#14181B' : '#F4F7FA'

const css = readFileSync(CSS, 'utf8')
const updated = css
  .replace(/--brand-canvas:\s*[^;]+;/g, `--brand-canvas: ${hex};`)
  .replace(/--brand-canvas-ink:\s*[^;]+;/g, `--brand-canvas-ink: ${ink};`)

if (updated === css) {
  console.error(`Could not find --brand-canvas in ${CSS}.`)
  process.exit(1)
}
writeFileSync(CSS, updated)

console.log(`Sampled ${file} — ${reds.length} edge pixels, ${band}px band.`)
console.log(`  --brand-canvas:     ${hex}`)
console.log(`  --brand-canvas-ink: ${ink}  (${luminance > 0.5 ? 'dark ink on a light ground' : 'light ink on a dark ground'})`)
console.log(`Written to ${CSS}. Restart the dev server to see it.`)
