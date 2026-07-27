import type { CaseStudy } from '@/data/case-studies/types'

// Formats a generated report into a ready-to-paste Slack newsletter message.
// Pure function (usable client- or server-side) — the caller supplies the full
// public URL so this stays origin-agnostic. Anonymized by construction: it only
// reads the already-anonymized CaseStudy payload (no brand name lives there).
export function buildSlackMessage(cs: CaseStudy, fullUrl: string): string {
  const industry = cs.hero.meta.find((m) => /industry/i.test(m.label))?.value

  const statLines = cs.statStrip.map(
    (s) => `• ${s.label}: ${s.value} (vs ${s.benchmarkValue} ${s.benchmarkLabel})`,
  )

  return [
    `📈 *New Marketing Moment Report*`,
    ``,
    `*${cs.hero.headline}*`,
    ``,
    `💰 ${cs.hero.stat.value} ${cs.hero.stat.caption}`,
    ``,
    ...statLines,
    ``,
    industry ? `Industry: ${industry}` : null,
    `See the full breakdown → ${fullUrl}`,
  ]
    .filter((l) => l !== null)
    .join('\n')
}
