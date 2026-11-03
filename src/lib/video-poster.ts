'use client'

// Grab a still frame out of a video FILE, in the browser, before it is uploaded.
//
// Why here and not on the server: the only still we had for a video was Drive's
// thumbnail of the original, so a re-cut ad kept showing the cut it replaced
// (see migration 20261103_video_revision_posters). The server cannot make one —
// Vercel has no ffmpeg — but the browser already has the file and a <video>
// element that decodes it.
//
// Best-effort by design. A codec the browser cannot decode, a file that stalls,
// a tainted canvas: all return null, the revision is recorded without a poster,
// and the viewers fall back to Drive's. A missing picture must never cost the
// editor the upload itself.

/** Longest edge of the captured still. Enough for the 2048 full view to look sharp. */
const POSTER_MAX_EDGE = 1280

/** How long to wait for the browser to decode and seek before giving up. */
const CAPTURE_TIMEOUT_MS = 15_000

export async function captureVideoPoster(file: File): Promise<Blob | null> {
  if (typeof document === 'undefined') return null

  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.playsInline = true
  // Some browsers will not paint a frame of a file: URL into a canvas without it.
  video.crossOrigin = 'anonymous'

  try {
    return await new Promise<Blob | null>(resolve => {
      let settled = false
      const done = (blob: Blob | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(blob)
      }
      const timer = setTimeout(() => done(null), CAPTURE_TIMEOUT_MS)

      video.onerror = () => done(null)

      video.onloadeddata = () => {
        // Frame 0 of an exported ad is often a black lead-in; a tenth of a
        // second in is the first frame a person would call "the ad". Short
        // clips fall back to whatever frame 0 is.
        const at = video.duration && video.duration > 0.2 ? 0.1 : 0
        if (Math.abs(video.currentTime - at) < 0.001) video.onseeked?.(new Event('seeked'))
        else video.currentTime = at
      }

      video.onseeked = () => {
        const w = video.videoWidth
        const h = video.videoHeight
        if (!w || !h) return done(null)
        const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(w, h))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(w * scale)
        canvas.height = Math.round(h * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) return done(null)
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        } catch {
          return done(null)
        }
        canvas.toBlob(b => done(b), 'image/jpeg', 0.82)
      }

      video.src = url
    })
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}
