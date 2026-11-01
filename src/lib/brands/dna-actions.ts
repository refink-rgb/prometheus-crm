'use server'

// Brand DNA build: website research, the client's guideline files, and
// everything else on the brand page, digested once into one record. Writes a new
// active row on `brand_dna` and flips the prior one off, so older versions are
// kept. Only ever runs from the button: the rest of the app reads the result.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { canEdit } from '@/lib/permissions'
import { BRAND_DOC_BUCKET } from '@/lib/brand-docs'
import { MAX_GUIDELINE_BYTES, parseGuideline, type GuidelinePayload } from '@/lib/ai/brand-guideline'
import type { ClientFile } from '@/lib/ai/gemini'
import type { BrandComment, BrandDocument } from '@/lib/types'
import { dnaSources } from './dna-sources'
import { loadRules, RULE_AREAS } from './profile'

// Each guideline PDF is a separate model read. Three covers a brand book plus
// its addenda without letting a brand with twenty files burn the budget.
const MAX_FILES_PER_KIND = 3

type Build = { ok: true; skipped: string[] } | { ok: false; error: string }
type Doc = Pick<BrandDocument, 'id' | 'file_name' | 'storage_path' | 'byte_size' | 'mime_type' | 'kind'>
type Contract = { id: string; title: string; signed_on: string | null; deliverables: string; revisions: string; special_terms: string; updated_at: string }

async function readFile(doc: Doc): Promise<GuidelinePayload> {
  const { data, error } = await createServiceClient().storage.from(BRAND_DOC_BUCKET).download(doc.storage_path)
  if (error || !data) throw new Error(error?.message ?? 'not found')
  if (doc.mime_type === 'text/plain') {
    const text = await data.text()
    return { kind: 'text', text, bytes: data.size }
  }
  return parseGuideline(doc.file_name, await data.arrayBuffer())
}

function toClientFile(name: string, payload: GuidelinePayload): ClientFile {
  return payload.kind === 'pdf'
    ? { name, kind: 'pdf', base64: payload.base64, mimeType: payload.mimeType }
    : { name, kind: 'text', text: payload.text }
}

export async function buildBrandDnaFromAll(brandId: string): Promise<Build> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) return { ok: false, error: 'Not authorized.' }

  try {
    const [{ data: brandRow }, { data: docRows }, { data: contractRows }, { data: commentRows }, rules] = await Promise.all([
      supabase.from('brands').select('name, website, brand_notes, brand_guidelines, intake_answers, onboarding_transcript').eq('id', brandId).single(),
      supabase.from('brand_documents').select('id, file_name, storage_path, byte_size, mime_type, kind').eq('brand_id', brandId).order('created_at', { ascending: false }),
      supabase.from('brand_contracts').select('id, title, signed_on, deliverables, revisions, special_terms, updated_at').eq('brand_id', brandId).order('created_at', { ascending: false }),
      supabase.from('brand_comments').select('id, author_name, content, created_at').eq('brand_id', brandId).order('created_at', { ascending: true }),
      loadRules(supabase, brandId, { includeRetired: false }),
    ])
    if (!brandRow) return { ok: false, error: 'Brand not found.' }
    const brand = brandRow as { name: string; website: string | null; brand_notes: string | null; brand_guidelines: string | null; intake_answers: string | null; onboarding_transcript: string | null }
    const documents = (docRows ?? []) as Doc[]
    const contracts = (contractRows ?? []) as Contract[]
    const comments = (commentRows ?? []) as Pick<BrandComment, 'id' | 'author_name' | 'content' | 'created_at'>[]

    const skipped: string[] = []
    const pick = (kind: 'guidelines' | 'intake') => {
      const docs = documents.filter(d => d.kind === kind)
      for (const d of docs.slice(MAX_FILES_PER_KIND)) skipped.push(`${d.file_name} (only the newest ${MAX_FILES_PER_KIND} are read)`)
      return docs.slice(0, MAX_FILES_PER_KIND).filter(d => {
        if (d.byte_size <= MAX_GUIDELINE_BYTES) return true
        skipped.push(`${d.file_name} (over ${MAX_GUIDELINE_BYTES / 1024 / 1024}MB)`)
        return false
      })
    }
    const guidelineDocs = pick('guidelines')
    const intakeDocs = pick('intake')

    const sections: { title: string; text: string }[] = []
    const add = (title: string, text: string | null | undefined) => { if (text?.trim()) sections.push({ title, text: text.trim() }) }
    add('Onboarding call transcript', brand.onboarding_transcript?.slice(0, 200_000))
    add('Intake answers', brand.intake_answers)
    for (const c of contracts) {
      add(`Contract: ${c.title}${c.signed_on ? ` (${c.signed_on})` : ''}`,
        `Deliverables:\n${c.deliverables}\n\nRevisions:\n${c.revisions}\n\nSpecial terms:\n${c.special_terms}`)
    }
    add('Client feedback that applies to all work', rules.map(r =>
      `- [${RULE_AREAS[r.area]?.label ?? r.area}] ${r.rule}${r.why ? ` (why: ${r.why})` : ''}`).join('\n'))
    add('Client guidelines, pasted', brand.brand_guidelines)
    add('Internal notes', brand.brand_notes)
    add('Team notes', comments.map(c => `${c.created_at.slice(0, 10)} ${c.author_name}: ${c.content}`).join('\n'))

    const { researchBrandDna, readBrandGuideline, synthesizeBrandDna, digestClientInfo } = await import('@/lib/ai/gemini')
    const { extractSitePalette } = await import('@/lib/ai/palette')
    const { TEXT_FIELDS } = await import('@/lib/ai/brand-dna-schema')

    const readGuideline = async (d: Doc) => {
      try {
        return (await readBrandGuideline(brand.name, await readFile(d))).dossier
      } catch (e) {
        skipped.push(`${d.file_name} (${e instanceof Error ? e.message : 'could not be read'})`)
        return null
      }
    }
    const readIntake = async (d: Doc) => {
      try {
        return toClientFile(d.file_name, await readFile(d))
      } catch (e) {
        skipped.push(`${d.file_name} (${e instanceof Error ? e.message : 'could not be read'})`)
        return null
      }
    }

    const [research, palette, guidelineDossiers, intakeFiles] = await Promise.all([
      brand.website
        ? researchBrandDna(brand.name, brand.website).catch(e => {
            skipped.push(`Website (${e instanceof Error ? e.message : 'research failed'})`)
            return null
          })
        : null,
      // A client's own swatches beat a scraped CSS palette.
      brand.website && guidelineDocs.length === 0 ? extractSitePalette(brand.website).catch(() => null) : null,
      Promise.all(guidelineDocs.map(readGuideline)),
      Promise.all(intakeDocs.map(readIntake)),
    ])
    const files = intakeFiles.filter((f): f is ClientFile => !!f)
    const clientContext = sections.length || files.length
      ? await digestClientInfo(brand.name, sections, files)
      : null

    const dossier = [
      ...guidelineDossiers.filter(Boolean).map(d => `# From the client's brand guidelines\n\n${d}`),
      clientContext && `# What the client and team have told us\n\n${clientContext}`,
      research && `# Public research from the website\n\n${research.dossier}`,
    ].filter(Boolean).join('\n\n---\n\n')
    if (!dossier) return { ok: false, error: 'Nothing to build from yet. Add a website, a guideline file or the onboarding call.' }

    const dna = await synthesizeBrandDna(dossier, research?.urls ?? [], palette,
      'This dossier combines first-party material with public research. Where they disagree, the client\'s guidelines and what the client told us win over public research. Treat values stated in the guidelines as specification. "Currently in play" items describe one campaign: never turn them into proof points, common offers or standing brand facts.')

    const normalized: Record<string, unknown> = { ...dna }
    for (const field of TEXT_FIELDS) {
      if (normalized[field] === '') normalized[field] = null
    }

    const { data: prevActive } = await supabase
      .from('brand_dna')
      .select('id, version, logo_url')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .maybeSingle()

    if (prevActive) {
      const { error: flipErr } = await supabase.from('brand_dna').update({ is_active: false }).eq('id', prevActive.id)
      if (flipErr) return { ok: false, error: `Failed to deactivate prior Brand DNA: ${flipErr.message}` }
    }

    const { error } = await supabase.from('brand_dna').insert({
      ...normalized,
      brand_id: brandId,
      version: (prevActive?.version ?? 0) + 1,
      is_active: true,
      logo_url: prevActive?.logo_url ?? null,
      client_context: clientContext,
      built_from: dnaSources({ ...brand, documents, contracts, rules, comments }),
    })
    if (error) return { ok: false, error: `Failed to save Brand DNA: ${error.message}` }

    revalidatePath(`/brands/${brandId}`)
    return { ok: true, skipped }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[buildBrandDnaFromAll]', brandId, msg, e)
    return { ok: false, error: msg }
  }
}
