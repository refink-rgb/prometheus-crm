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
export async function extractReportFromCaseStudy(text: string): Promise<ReportInputs> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated.')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const clean = text.trim()
  if (clean.length < 200) throw new Error('That document looks too short to be a case study.')

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set. Add it in Vercel → Settings → Environment Variables.')

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
  if (!raw) throw new Error('The importer returned nothing. Try again.')

  let parsed: ExtractedShape
  try {
    parsed = JSON.parse(raw) as ExtractedShape
  } catch {
    throw new Error('The importer returned malformed data. Try again.')
  }

  return normalizeExtracted(parsed)
}
