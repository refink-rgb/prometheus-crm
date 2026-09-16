// Copies pdf.js's LEGACY browser build and data files into public/pdfjs.
// Runs on install and before build, so the worker always matches the installed
// library (a worker from another version refuses to start). Copied as .js, not
// .mjs, so every static host serves a JavaScript MIME type.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

const root = path.join(process.cwd(), 'node_modules', 'pdfjs-dist')
const out = path.join(process.cwd(), 'public', 'pdfjs')
if (!existsSync(root)) {
  console.warn('[copy-pdfjs] pdfjs-dist is not installed; skipping')
  process.exit(0)
}
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(path.join(root, 'legacy/build/pdf.min.mjs'), path.join(out, 'pdf.min.js'))
cpSync(path.join(root, 'legacy/build/pdf.worker.min.mjs'), path.join(out, 'pdf.worker.min.js'))
for (const dir of ['standard_fonts', 'cmaps', 'wasm', 'iccs']) {
  cpSync(path.join(root, dir), path.join(out, dir), { recursive: true })
}
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
console.log(`[copy-pdfjs] pdf.js ${version} -> public/pdfjs`)
