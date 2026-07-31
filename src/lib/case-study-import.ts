'use server'

import OpenAI from 'openai'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import type { ReportInputs } from '@/data/case-studies/buildReport'
import { EXTRACT_SYSTEM_PROMPT, normalizeExtracted, type ExtractedShape } from '@/lib/caseStudyExtract'

// Turn a written case study into the report's slots. The .docx is parsed to
// plain text in the browser (mammoth) and only the text reaches this action, so
// there is no file upload to handle here.
//
// The model only RESTRUCTURES text already in the document. It is told not to
// invent figures, because every number here ends up on a page we send to
// prospects. Anything it cannot find is left blank for the author to fill in,
// and the result is always reviewed in the form before publishing.
/**
 * Result rather than a thrown error: Next.js replaces messages thrown from
 * server actions with a generic digest in production, which would hide exactly
 * the guidance the user needs (missing key, model refused, document too short).
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

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return { ok: false, message: 'OPENAI_API_KEY is not set. Add it in Vercel → Settings → Environment Variables, then redeploy.' }
    }

    const openai = new OpenAI({ apiKey })
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Case study document:\n\n${clean.slice(0, 24000)}\n\nReturn a single JSON object with the fields described.`,
        },
      ],
    })

    const raw = completion.choices[0]?.message?.content
    if (!raw) return { ok: false, message: 'The importer returned an empty response. Try again.' }

    let parsed: ExtractedShape
    try {
      parsed = JSON.parse(raw) as ExtractedShape
    } catch {
      return { ok: false, message: 'The importer returned malformed JSON. Try again.' }
    }

    return { ok: true, inputs: normalizeExtracted(parsed) }
  } catch (e) {
    // Surface the real cause (bad key, no model access, quota, network) instead
    // of letting Next.js swallow it into a digest.
    const message = e instanceof Error ? e.message : String(e)
    console.error('[case-study-import]', message)
    return { ok: false, message: `Import failed: ${message}` }
  }
}
