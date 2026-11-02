import { redirect } from 'next/navigation'

// Insights moved into the Dashboard's Management tab on 2026-11-02.
export default function InsightsPage() {
  redirect('/?tab=management')
}
