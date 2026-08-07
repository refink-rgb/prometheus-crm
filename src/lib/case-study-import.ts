'use server'

import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { extractCaseStudy } from '@/lib/ai/gemini'
import type { ReportInputs } from '@/data/case-studies/buildReport'
import { EXTRACT_SYSTEM_PROMPT, normalizeExtracted, type ExtractedShape } from '@/lib/caseStudyExtract'

// Turn a written case study into the report's slots. The .docx is parsed to
// plain text in the browser (mammoth) and only the text reaches this action, so
// there is no file upload to handle here.
//
// Uses the same Gemini client the Brand DNA feature runs on, so no new key or
// provider is involved. The model only RESTRUCTURES text already in the
// document; anything it cannot find is left blank for the author, and the
// result always lands in the form for review before publishing.

/**
 * Result rather than a thrown error: Next.js replaces messages thrown from
 * server actions with a generic digest in production, which would hide exactly
 * the guidance the user needs (missing key, empty response, wrong file).
 */
export type ImportResult = { ok: true; inputs: ReportInputs } | { ok: false; message: string }

export async function extractReportFromCaseStudy(text: string): Promise<ImportResult> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, message: 'Not authenticated.' }
    if (!canEdit(user.email)) return { ok: false, message: 'Not authorized.' }

    const clean = text.trim()
    if (clean.length < 200) {
      return { ok: false, message: `That document only produced ${clean.length} characters of text. Is it the right file?` }
    }

    const parsed = (await extractCaseStudy(EXTRACT_SYSTEM_PROMPT, clean.slice(0, 24000))) as ExtractedShape
    // The model is only asked for this shape, never held to it. Log what the
    // fields actually came back as: a section that imports blank is almost
    // always a shape the normaliser could not map, and this names it.
    console.log(
      '[case-study-import] shapes',
      Object.fromEntries(
        Object.entries(parsed ?? {}).map(([k, v]) => [k, Array.isArray(v) ? `array(${v.length})` : typeof v]),
      ),
    )
    return { ok: true, inputs: normalizeExtracted(parsed) }
  } catch (e) {
    // Surface the real cause (missing key, quota, network) rather than letting
    // Next.js swallow it into a digest.
    const message = e instanceof Error ? e.message : String(e)
    console.error('[case-study-import]', message)
    return { ok: false, message: `Import failed: ${message}` }
  }
}
