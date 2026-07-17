import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { bearerToken, validateEditorToken } from '@/lib/editor-auth'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * POST /api/creative/generate   (token-authed: Bearer editor token)
 *
 * Server-side GPT Image 2 proxy for the external creative skill, so editors
 * can generate product-faithful images without ever holding the OpenAI key.
 * One image per call — the skill loops for batches.
 *
 * Body: {
 *   prompt: string,
 *   image_urls?: string[],   // reference images (inspiration first, then product) — max 5
 *   size?: string,           // default "1024x1280" (4:5 @ 1K)
 *   quality?: "low" | "medium" | "high"   // default "medium"
 * }
 * Returns: { image_b64: string, mime: "image/png" }
 */
export async function POST(request: Request) {
  const supabase = createServiceClient()
  const auth = await validateEditorToken(supabase, bearerToken(request))
  if (!auth) {
    return NextResponse.json({ error: 'Invalid or missing editor token.' }, { status: 401 })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Image engine not configured.' }, { status: 500 })
  }

  let body: { prompt?: string; image_urls?: string[]; size?: string; quality?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const prompt = body.prompt?.trim()
  if (!prompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 })

  const size = body.size ?? '1024x1280'
  const quality = ['low', 'medium', 'high'].includes(body.quality ?? '')
    ? (body.quality as string)
    : 'medium'
  const imageUrls = (body.image_urls ?? []).slice(0, 5)

  try {
    if (imageUrls.length === 0) {
      // Text-only generation
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-2', prompt, size, quality, n: 1 }),
      })
      if (!res.ok) {
        return NextResponse.json({ error: `Engine ${res.status}: ${await res.text()}` }, { status: 502 })
      }
      const json = (await res.json()) as { data?: Array<{ b64_json?: string }> }
      const b64 = json.data?.[0]?.b64_json
      if (!b64) return NextResponse.json({ error: 'No image returned' }, { status: 502 })
      return NextResponse.json({ image_b64: b64, mime: 'image/png' })
    }

    // Reference-image generation via the edits endpoint
    const form = new FormData()
    form.append('model', 'gpt-image-2')
    form.append('prompt', prompt)
    form.append('size', size)
    form.append('quality', quality)
    form.append('n', '1')
    for (let i = 0; i < imageUrls.length; i++) {
      const imgRes = await fetch(imageUrls[i])
      if (!imgRes.ok) {
        return NextResponse.json(
          { error: `Reference image ${i + 1} could not be fetched (${imgRes.status}).` },
          { status: 400 },
        )
      }
      const buf = await imgRes.arrayBuffer()
      const ct = imgRes.headers.get('content-type') ?? 'image/png'
      form.append('image[]', new Blob([buf], { type: ct }), `ref-${i}.png`)
    }

    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
    if (!res.ok) {
      return NextResponse.json({ error: `Engine ${res.status}: ${await res.text()}` }, { status: 502 })
    }
    const json = (await res.json()) as { data?: Array<{ b64_json?: string }> }
    const b64 = json.data?.[0]?.b64_json
    if (!b64) return NextResponse.json({ error: 'No image returned' }, { status: 502 })
    return NextResponse.json({ image_b64: b64, mime: 'image/png' })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown engine error' },
      { status: 502 },
    )
  }
}
