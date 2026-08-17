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
      headers: htmlHeaders(),
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
      headers: htmlHeaders(),
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
      headers: htmlHeaders(),
    })
  }

  // <base href> must end in '/' so relative asset paths resolve to the origin.
  const baseHref = sourceUrl.replace(/[?#].*$/, '').replace(/[^/]*$/, '')
  const cleaned = sanitizeForPreview(html, baseHref, sourceUrl)

  return new Response(cleaned, {
    status: 200,
    headers: htmlHeaders(new URL(sourceUrl).origin),
  })
}

function htmlHeaders(sourceOrigin?: string): Record<string, string> {
  // Apply the sandbox in the response too, so direct visits to /api/preview
  // remain isolated instead of relying only on the embedding iframe.
  const sandbox = sourceOrigin
    ? `sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads; form-action ${sourceOrigin}; frame-ancestors 'self'`
    : `sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; frame-ancestors 'self'`

  return {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': sandbox,
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-robots-tag': 'noindex, nofollow, noarchive',
    'cache-control': 'no-store, no-cache, must-revalidate',
  }
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

  // 1. Keep the page's scripts so JavaScript-rendered product grids and theme
  // interactions work. The response CSP and iframe both omit
  // allow-same-origin, so these scripts execute in an opaque origin and cannot
  // inherit Prometheus credentials or reach the parent document.

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

  // 6. Drop speculative prefetches. Script and module preloads stay because
  // the interactive preview now executes the page's JavaScript.
  $('link[rel="prefetch"]').remove()

  // 7. Ensure a <base href> so relative URLs resolve back to the original
  // domain. Without this every relative asset 404s against our origin.
  $('base').remove()
  $('head').prepend(`<base href="${escapeHtml(baseHref)}">`)

  // A meta refresh can navigate the iframe away from the sandboxed proxy and
  // replace the review with a frame-blocked live page.
  $("meta[http-equiv='refresh']").remove()

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

  // 10. Bridge the isolated document to the review UI. It only exchanges pin
  // coordinates and readiness state; no comments, tokens, or account data enter
  // the untrusted frame.
  $('head').append(`<script>${PREVIEW_BRIDGE_SCRIPT}</script>`)

  // 11. Discreet preview badge linking to the live page.
  $('body').append(`
    <div style="position:fixed;bottom:12px;left:12px;z-index:2147483647;
      background:rgba(0,0,0,.7);color:#fff;font:11px -apple-system,sans-serif;
      padding:6px 10px;border-radius:6px;pointer-events:auto;">
      Isolated preview ·
      <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer"
         style="color:#fff;text-decoration:underline;">Open live page</a>
    </div>
  `)

  return $.html()
}

const PREVIEW_BRIDGE_SCRIPT = String.raw`
(() => {
  const channel = 'prometheus-lp-preview-v1'
  const layerId = '__lp_pin_layer'
  const cursorId = '__lp_pin_cursor'
  let markers = []
  let pinMode = false

  const send = (type, payload = {}) => {
    if (window.parent === window) return
    window.parent.postMessage({ channel, type, ...payload }, '*')
  }

  const size = () => {
    const scroller = document.scrollingElement || document.documentElement
    return {
      width: Math.max(1, scroller?.scrollWidth || 0),
      height: Math.max(1, scroller?.scrollHeight || 0),
    }
  }

  const renderMarkers = () => {
    if (!document.body) return
    let layer = document.getElementById(layerId)
    if (!layer) {
      layer = document.createElement('div')
      layer.id = layerId
      layer.style.cssText = 'position:absolute;inset:0 auto auto 0;margin:0;padding:0;pointer-events:none;z-index:2147483647'
      document.body.appendChild(layer)
    }
    layer.textContent = ''
    const documentSize = size()

    for (const marker of markers) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = String(marker.number)
      button.setAttribute('aria-label', 'Open pinned comment ' + marker.number)
      button.style.cssText = [
        'position:absolute',
        'left:' + ((marker.x / 100) * documentSize.width) + 'px',
        'top:' + ((marker.y / 100) * documentSize.height) + 'px',
        'transform:translate(-50%,-50%)',
        'width:26px', 'height:26px', 'border-radius:50%',
        'background:' + (marker.active ? '#ffffff' : '#6366f1'),
        'color:' + (marker.active ? '#6366f1' : '#ffffff'),
        'border:2px solid #ffffff',
        'font:700 12px/1 system-ui,-apple-system,sans-serif',
        'display:flex', 'align-items:center', 'justify-content:center',
        'box-shadow:0 2px 8px rgba(0,0,0,0.45)',
        'pointer-events:' + (marker.pending ? 'none' : 'auto'),
        'cursor:pointer', 'user-select:none', 'padding:0',
      ].join(';')
      if (!marker.pending) {
        button.addEventListener('click', event => {
          event.preventDefault()
          event.stopPropagation()
          send('pin-activated', { number: marker.number })
        })
      }
      layer.appendChild(button)
    }
  }

  const setPinMode = enabled => {
    pinMode = Boolean(enabled)
    document.getElementById(cursorId)?.remove()
    if (!pinMode) return
    const style = document.createElement('style')
    style.id = cursorId
    style.textContent = '*{cursor:crosshair !important}'
    ;(document.head || document.body).appendChild(style)
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent) return
    const data = event.data
    if (!data || data.channel !== channel) return
    if (data.type === 'markers') {
      markers = Array.isArray(data.markers) ? data.markers : []
      renderMarkers()
    } else if (data.type === 'pin-mode') {
      setPinMode(data.enabled)
    } else if (data.type === 'ping') {
      send('status', { status: 'ok' })
      renderMarkers()
    }
  })

  document.addEventListener('click', event => {
    if (!pinMode || event.target?.closest?.('#' + layerId)) return
    event.preventDefault()
    event.stopPropagation()
    const documentSize = size()
    const x = Math.min(100, Math.max(0, (event.pageX / documentSize.width) * 100))
    const y = Math.min(100, Math.max(0, (event.pageY / documentSize.height) * 100))
    setPinMode(false)
    send('pin-selected', { x, y })
  }, true)

  const ready = () => {
    renderMarkers()
    send('status', { status: 'ok' })
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready, { once: true })
  } else {
    ready()
  }
  window.addEventListener('load', ready, { once: true })
  window.addEventListener('resize', renderMarkers)
  if (window.ResizeObserver) new ResizeObserver(renderMarkers).observe(document.documentElement)
})()
`

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!,
  )
}

function renderErrorCard(sourceUrl: string | null, status: number | string): string {
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
    ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer"
         style="display:inline-block;background:#18181b;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Open live page →</a>`
    : ''
  const code = sourceUrl
    ? `<code style="display:block;font-size:12px;color:#71717a;background:#f4f4f5;padding:8px 12px;border-radius:6px;margin-bottom:16px;word-break:break-all">${escapeHtml(sourceUrl)}</code>`
    : ''
  return `<!doctype html><meta charset="utf-8"><meta name="__preview_status" content="fallback"><script>if(parent!==window)parent.postMessage({channel:'prometheus-lp-preview-v1',type:'status',status:'fallback'},'*')</script><body style="font:15px/1.5 -apple-system,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#fafafa">
    <div style="max-width:460px;padding:32px;background:#fff;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.06)">
      <h1 style="font-size:18px;margin:0 0 8px">Can't render this page here</h1>
      <p style="color:#52525b;margin:0 0 16px">${reason}. The link itself is fine — opening it directly works.</p>
      ${code}
      ${link}
    </div></body>`
}
