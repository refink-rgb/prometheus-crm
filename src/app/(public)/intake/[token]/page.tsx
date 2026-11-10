import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import { isIntakeToken, normalizeIntake } from '@/lib/brands/intake'
import IntakeFormView, { type IntakeFile } from '@/components/intake/IntakeForm'
import '@/components/intake/intake.css'

// The client's intake link. No account: the token in the URL is the key, and
// the service client below reads only this brand, only what the form shows.

export const metadata: Metadata = { title: 'Brand intake', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function IntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!isIntakeToken(token)) notFound()
  const db = createServiceClient()
  const { data: brand } = await db
    .from('brands')
    .select('id, name, intake_form, intake_submitted_at, intake_updated_at, ai_sensitivity')
    .eq('intake_token', token)
    .maybeSingle()
  if (!brand) notFound()

  const { data: docs } = await db
    .from('brand_documents')
    .select('id, file_name, kind, byte_size, from_client, created_at')
    .eq('brand_id', brand.id)
    .in('kind', ['guidelines', 'logo', 'product_images', 'fonts', 'intake', 'other'])
    .order('created_at', { ascending: true })

  // First visit: start from what the team already has, so the client confirms
  // rather than retypes.
  const form = normalizeIntake(brand.intake_form ?? { ai: brand.ai_sensitivity ?? null })

  return (
    <IntakeFormView
      token={token}
      brandName={brand.name as string}
      initial={form}
      files={(docs ?? []) as IntakeFile[]}
      submittedAt={(brand.intake_submitted_at as string | null) ?? null}
    />
  )
}
