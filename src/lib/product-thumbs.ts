// Finding a thumbnail for a product, from its own product page.
//
// An editor needs to see what they are drawing. The product link already points
// at the thing; this pulls the picture off it so the Creatives tab can show it
// without anyone uploading anything.
//
// THREE SOURCES, IN THIS ORDER, because they are not equally trustworthy:
//
// 1. Shopify's product JSON (<pdp-url>.json). Every store in this CRM is
//    Shopify. It returns the real product images with the product's own title,
//    so there is no guessing.
// 2. og:image on the page. Correct for a non-Shopify product page.
// 3. Nothing.
//
// A COLLECTION OR CAMPAIGN PAGE IS SKIPPED, not fallen back on. Measured:
// og:image on obnoxiousgolf.com/collections/... and
// allamericanclothing.com/pages/america-250 both return the STORE LOGO. A logo
// rendered in a product thumbnail slot is worse than an empty slot — it looks
// like a reference and carries no information, and an editor who glances at it
// learns something false.

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; PrometheusCRM/1.0; +internal)' }
const TIMEOUT_MS = 12_000

/** Only public http(s). This fetches a URL a person typed, from the server. */
function safeToFetch(raw: string): URL | null {
  let u: URL
  try { u = new URL(raw) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const h = u.hostname.toLowerCase()
  if (
    h === 'localhost' || h.endsWith('.localhost') || h === '::1' ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) || /^0\./.test(h) ||
    h.endsWith('.internal') || h.endsWith('.local')
  ) return null
  return u
}

const isProductPage = (u: URL) => /\/products\/[^/?#]+/.test(u.pathname)

function ogImage(html: string): string | null {
  const tags = [...html.matchAll(/<meta[^>]+>/gi)].map(m => m[0])
  for (const prop of ['og:image:secure_url', 'og:image', 'twitter:image']) {
    const tag = tags.find(t => new RegExp(`(property|name)\\s*=\\s*["']${prop}["']`, 'i').test(t))
    const c = tag?.match(/content\s*=\s*["']([^"']+)["']/i)
    if (c?.[1]?.startsWith('http')) return c[1]
  }
  return null
}

export interface ThumbResult {
  image: string | null
  /** Why there is no image, for the UI to say something useful. */
  reason?: 'not-a-product-page' | 'unreachable' | 'no-image' | 'bad-url'
}

export async function fetchProductThumbnail(rawUrl: string): Promise<ThumbResult> {
  const u = safeToFetch(rawUrl)
  if (!u) return { image: null, reason: 'bad-url' }

  // A collection or campaign page has no single product image. Say so rather
  // than returning the store logo.
  if (!isProductPage(u)) return { image: null, reason: 'not-a-product-page' }

  const base = `${u.origin}${u.pathname.replace(/\/$/, '')}`

  // 1. Shopify product JSON.
  try {
    const r = await fetch(`${base}.json`, { headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (r.ok) {
      const d = await r.json() as { product?: { images?: { src?: string }[] } }
      const src = d?.product?.images?.[0]?.src
      if (typeof src === 'string' && src.startsWith('http')) return { image: src }
    }
  } catch { /* fall through to og */ }

  // 2. og:image.
  try {
    const r = await fetch(u.toString(), { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!r.ok) return { image: null, reason: 'unreachable' }
    // Cap the read: a product page is a few hundred KB and the meta tags are at
    // the top, so there is no reason to buffer a whole marketing page.
    const html = (await r.text()).slice(0, 300_000)
    const img = ogImage(html)
    return img ? { image: img } : { image: null, reason: 'no-image' }
  } catch {
    return { image: null, reason: 'unreachable' }
  }
}
