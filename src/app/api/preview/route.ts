import * as cheerio from 'cheerio'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// SSRF-safe: we never accept a raw `?url`. The client passes the project's
// share token, we look up `lp_url` server-side, then proxy that.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token')
  if (!token) {
    return new Response(renderErrorCard(null, 'no_token'), {
      status: 200,
      headers: HTML_HEADERS,
    })
  }

  const supabase = await createClient()
  const { data: project } = await supabase
    .from('projects')
    .select('lp_url')
    .eq('share_token', token)
    .single<{ lp_url: string | null }>()

  const sourceUrl = project?.lp_url ?? null
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
    return new Response(renderErrorCard(sourceUrl, 'no_url'), {
      status: 200,
      headers: HTML_HEADERS,
    })
  }

  let html: string | null = null
  let upstreamStatus = 0

  try {
    const upstream = await fetch(sourceUrl, {
      cache: 'no-store',
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'sec-ch-ua':
          '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
      },
    })
    upstreamStatus = upstream.status
    if (upstream.ok) html = await upstream.text()
  } catch {
    /* network failure → fallback card below */
  }

  if (!html) {
    return new Response(renderErrorCard(sourceUrl, upstreamStatus || 502), {
      status: 200,
      headers: HTML_HEADERS,
    })
  }

  // <base href> must end in '/' so relative asset paths resolve to the origin.
  const baseHref = sourceUrl.replace(/[?#].*$/, '').replace(/[^/]*$/, '')
  const cleaned = sanitizeForPreview(html, baseHref, sourceUrl)

  return new Response(cleaned, { status: 200, headers: HTML_HEADERS })
}

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'cache-control': 'no-store, no-cache, must-revalidate',
}

function sanitizeForPreview(
  html: string,
  baseHref: string,
  sourceUrl: string,
): string {
  const $ = cheerio.load(html)

  // Mark this as a successful render so the client can distinguish from the
  // fallback card.
  $('head').prepend('<meta name="__preview_status" content="ok">')

  // 1. Strip all scripts. A visual review needs no JS; this removes
  // frame-busting, CORS fetches, cookie/geo/email popups, chat widgets.
  $('script').remove()
  $('noscript').remove()

  // 2. Drop CSP / X-Frame meta tags.
  $("meta[http-equiv='Content-Security-Policy']").remove()
  $("meta[http-equiv='X-Frame-Options']").remove()

  // 3. Drop tracking/analytics iframes but keep real video embeds.
  $('iframe').each((_, el) => {
    const src = $(el).attr('src') || ''
    if (!/youtube|vimeo|tiktok|wistia|loom/i.test(src)) $(el).remove()
  })

  // 4. Convert lazy-load attrs to real src/srcset + force eager.
  $('img').each((_, el) => {
    const $el = $(el)
    const src = $el.attr('src')
    const dataSrc =
      $el.attr('data-src') ||
      $el.attr('data-original') ||
      $el.attr('data-lazy-src') ||
      $el.attr('data-srcset')?.split(',')[0]?.trim().split(' ')[0]
    if (
      dataSrc &&
      (!src || /placeholder|loading|blank|spinner|lazyload|1x1/i.test(src))
    ) {
      $el.attr('src', dataSrc)
    }
    const dataSrcset = $el.attr('data-srcset')
    if (dataSrcset && !$el.attr('srcset')) $el.attr('srcset', dataSrcset)
    $el.removeAttr('loading')
    $el.removeAttr('data-src')
    $el.removeAttr('data-original')
    $el.removeAttr('data-lazy-src')
    $el.removeAttr('data-srcset')
  })

  // 5. Same lazy fix for <source>.
  $('source').each((_, el) => {
    const $el = $(el)
    const dataSrcset = $el.attr('data-srcset')
    if (dataSrcset && !$el.attr('srcset')) $el.attr('srcset', dataSrcset)
  })

  // 6. Drop preload/prefetch hints that point at JS.
  $('link[rel="preload"][as="script"]').remove()
  $('link[rel="modulepreload"]').remove()
  $('link[rel="prefetch"]').remove()

  // 7. Ensure a <base href> so relative URLs resolve back to the original
  // domain. Without this every relative asset 404s against our origin.
  if (!$('base').length) $('head').prepend(`<base href="${baseHref}">`)

  // 8. Reveal CSS — many themes hide body until JS marks the page "loaded",
  // and many animations sit at opacity:0 waiting for an IntersectionObserver
  // that will never fire. Also nuke common preloader/cookie/geo/email overlays.
  $('head').append(`
    <style id="__preview_reveal">
      html, body { visibility: visible !important; opacity: 1 !important; }
      .preloader, .page-loader, .loading-overlay, .loader-wrap,
      [data-preloader], [data-loader], .js-loading,
      .shopify-section--loading, .skeleton-loader { display: none !important; }
      .swiper-wrapper, .slick-slider, .splide__list,
      [data-carousel]:not(.no-carousel) { display: block !important; }
      .swiper-slide:not(:first-child), .slick-slide:not(:first-child),
      .splide__slide:not(:first-child) { display: none !important; }
      [data-aos], [data-animation], .reveal, .animate-on-scroll,
      .fade-in, .scroll-trigger {
        opacity: 1 !important; transform: none !important; visibility: visible !important;
      }
      [id*="orbe" i], [class*="orbe" i],
      .md-modal, .md-modal__container, #md-app-embed__modal, .md-app-embed,
      #shopify-pc__banner, [id*="pandectes" i], [class*="pandectes" i],
      [class*="cookie-banner" i], [id*="cookie-banner" i], [class*="cookie-consent" i],
      .klaviyo-form, [class*="kl-private" i], [class*="needsclick" i] {
        display: none !important;
      }
    </style>
  `)

  // 9. Some themes set body display:none via a cross-origin stylesheet that
  // wins specificity against an appended <style>. An inline !important wins.
  const reveal =
    'display:block !important;visibility:visible !important;opacity:1 !important;'
  ;['html', 'body'].forEach((tag) => {
    const $el = $(tag)
    $el.attr('style', `${$el.attr('style') || ''};${reveal}`)
  })

  // 10. Discreet "static snapshot" badge linking to the live page.
  $('body').append(`
    <div style="position:fixed;bottom:12px;left:12px;z-index:2147483647;
      background:rgba(0,0,0,.7);color:#fff;font:11px -apple-system,sans-serif;
      padding:6px 10px;border-radius:6px;pointer-events:auto;">
      Static snapshot ·
      <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer"
         style="color:#fff;text-decoration:underline;">Open live page</a>
    </div>
  `)

  return $.html()
}

function renderErrorCard(sourceUrl: string | null, status: number | string): string {
  const esc = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c]!,
    )
  const reason =
    status === 'no_url'
      ? 'No landing page URL has been set yet'
      : status === 'no_token'
        ? 'Missing review token'
        : status === 403 || status === 401
          ? 'The site is blocking automated requests'
          : status === 404
            ? 'The page was not found'
            : 'The site is temporarily unavailable'
  const link = sourceUrl
    ? `<a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer"
         style="display:inline-block;background:#18181b;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Open live page →</a>`
    : ''
  const code = sourceUrl
    ? `<code style="display:block;font-size:12px;color:#71717a;background:#f4f4f5;padding:8px 12px;border-radius:6px;margin-bottom:16px;word-break:break-all">${esc(sourceUrl)}</code>`
    : ''
  return `<!doctype html><meta charset="utf-8"><meta name="__preview_status" content="fallback"><body style="font:15px/1.5 -apple-system,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#fafafa">
    <div style="max-width:460px;padding:32px;background:#fff;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.06)">
      <h1 style="font-size:18px;margin:0 0 8px">Can't render this page here</h1>
      <p style="color:#52525b;margin:0 0 16px">${reason}. The link itself is fine — opening it directly works.</p>
      ${code}
      ${link}
    </div></body>`
}
