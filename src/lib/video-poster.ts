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
// a tainted canvas: all return null and the revision is recorded without a
// poster. A missing picture must never cost the editor the upload itself.
//
// Every failure is logged with its reason. It used to return null five
// different ways in silence, so a ProRes .mov or a Safari stall looked exactly
// like a successful upload and the only symptom was a tile that never changed.

/** Longest edge of the captured still. Enough for the 2048 full view to look sharp. */
const POSTER_MAX_EDGE = 1280

/** How long to wait for the browser to decode and seek before giving up. */
const CAPTURE_TIMEOUT_MS = 15_000

export async function captureVideoPoster(file: File): Promise<Blob | null> {
  if (typeof document === 'undefined') return null

  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  // 'metadata' only guarantees duration and dimensions, not a decoded frame.
  // Safari can satisfy it without ever firing loadeddata, so the capture sat
  // there until the 15s timeout and the upload kept the old cut's still.
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  // No crossOrigin: an object URL is same-origin, so the canvas is never
  // tainted by it — and setting it makes some browsers refuse the blob: load.

  try {
    return await new Promise<Blob | null>(resolve => {
      let settled = false
      const done = (blob: Blob | null, why?: string) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (!blob) console.error('[captureVideoPoster] no still for', file.name, `(${file.type}, ${(file.size / 1048576).toFixed(1)}MB):`, why)
        resolve(blob)
      }
      const timer = setTimeout(() => done(null, `timed out after ${CAPTURE_TIMEOUT_MS}ms waiting to decode`), CAPTURE_TIMEOUT_MS)

      video.onerror = () => done(null, `the browser could not decode this file (${video.error?.message || 'no detail'}) — ProRes and other NLE-native exports do not decode in Chrome or Safari`)

      // loadedmetadata, not loadeddata: metadata is enough to know the duration
      // and to seek, and it is the event every browser actually fires.
      video.onloadedmetadata = () => {
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
        if (!w || !h) return done(null, 'seeked but the video reported no dimensions')
        const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(w, h))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(w * scale)
        canvas.height = Math.round(h * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) return done(null, 'no 2d canvas context')
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        } catch (e) {
          return done(null, `canvas refused the frame: ${e instanceof Error ? e.message : String(e)}`)
        }
        canvas.toBlob(b => done(b, b ? undefined : 'canvas.toBlob returned nothing'), 'image/jpeg', 0.82)
      }

      video.src = url
    })
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}
