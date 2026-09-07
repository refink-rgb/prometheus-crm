// A short, searchable code per project, so a media buyer can find every ad set
// and ad for one marketing moment by pasting one string into Ads Manager.
//
// Roberto's rule, verbatim:
//   first letters of the brand name  +  first letters of the offer name  +  the date
//   Ion Layer / "Labor Day $150 Off" / 5 Sep 2026   ->   ILLD$O050926
//
// One solid token, no separators. Slashes and dashes are both spoken for:
// the CTC campaign taxonomy separates on " - ", the media-buying scale filter
// treats " | " as "already scaled", and a slash inside an ad name lands in a
// URL when utm_content={{ad.name}} is in play. A single token also means a
// substring search cannot half-match.
//
// Deliberately NOT a random id. It has to be readable at a glance in a list of
// forty ad sets, and typo-detectable by a human who knows the brand.

const CODE_CHAR = /[A-Za-z0-9$%]/

const firstChar = (w: string): string => {
  const m = w.match(CODE_CHAR)
  return m ? m[0].toUpperCase() : ''
}

const words = (s: string | null): string[] =>
  (s ?? '').replace(/[—–·]/g, ' ').split(/\s+/).filter(Boolean)

/**
 * Brand half. Multi-word brands take true initials; a ONE-word brand takes two
 * letters, because single initials collide — Skinit and Spikeball are both "S",
 * Noble and Naboso are both "N". Two letters separates all 25 brands today.
 */
export function brandCode(brandName: string): string {
  const w = words(brandName)
  if (w.length > 1) return w.map(firstChar).join('')
  return (brandName ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()
}

/**
 * Offer half, from the project name. Two things are stripped first:
 *
 *  - the trailing "— September 2026" the CRM appends, because the date is
 *    already the third segment and would otherwise be counted twice;
 *  - a leading repeat of the brand name, which several projects carry
 *    ("WOW Sports — Full Send Summer Bundle") and which produced a stutter
 *    like WS-WSFSSB.
 */
export function offerCode(projectName: string | null, brandName: string): string {
  const stripped = (projectName ?? '')
    .replace(/\s*[—–-]\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}.*$/i, '')
    .trim()
  const brandWords = words(brandName).map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
  let pw = words(stripped)
  while (pw.length > 1 && brandWords.includes(pw[0].toLowerCase().replace(/[^a-z0-9]/g, ''))) {
    pw = pw.slice(1)
  }
  return pw.map(firstChar).join('').replace(/^[^A-Z0-9$%]+/, '')
}

/** DDMMYY. Six digits, no separators — the numeric tail anchors the eye. */
const dmy = (iso: string): string => {
  const [y, m, d] = iso.split('-')
  return `${d}${m}${y.slice(2)}`
}

/**
 * The whole code. Returns null when there is no due date to date it by — a
 * code without one is not searchable in any useful way, and every project in
 * the CRM has a due date today.
 */
export function momentCode(
  brandName: string,
  projectName: string | null,
  dueDate: string | null,
): string | null {
  if (!dueDate) return null
  const b = brandCode(brandName)
  const o = offerCode(projectName, brandName)
  if (!b || !o) return null
  return `${b}${o}${dmy(dueDate)}`
}
