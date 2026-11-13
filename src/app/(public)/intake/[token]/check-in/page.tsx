import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import { isIntakeToken } from '@/lib/brands/intake'
import CheckInForm from '@/components/intake/CheckInForm'
import '@/components/intake/intake.css'

// The client's check-in survey, on the same link as their intake form. No
// account: the token is the key, and only the brand name is read.

export const metadata: Metadata = { title: 'Check-in', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function CheckInPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!isIntakeToken(token)) notFound()
  const { data: brand } = await createServiceClient()
    .from('brands').select('name').eq('intake_token', token).maybeSingle()
  if (!brand) notFound()
  return <CheckInForm token={token} brandName={brand.name as string} />
}
