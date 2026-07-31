import type { CaseStudy } from '@/data/case-studies/types'

// Assemble the Slack announcement. The post itself is written per case study
// (authored on import, editable in the form) so it reads like the approved
// example: a hook, the context, the problem, what we built, bullet metrics,
// then a payoff line. The URL is appended here rather than stored, so the
// message always points at the current link.
//
// The fallback below is only used when no post has been written yet. It is
// deliberately plain: better a bare summary than a fake-sounding narrative.
export function buildSlackMessage(cs: CaseStudy, fullUrl: string): string {
  const written = cs.slackPost?.trim()
  if (written) {
    // Drop any URL the author left in, so we never emit two links.
    const body = written.replace(/https?:\/\/\S*showcase\/\S+/g, '').trimEnd()
    return `${body}\n\n${fullUrl}`
  }

  const statLines = cs.statStrip
    .filter((s) => s.label && s.value)
    .map((s) => `• ${s.value} ${s.label.toLowerCase()}, ${s.benchmarkLabel}: ${s.benchmarkValue}`)

  return [
    `${cs.hero.headline}`,
    '',
    cs.hero.stat.value ? `${cs.hero.stat.value} ${cs.hero.stat.caption}` : null,
    statLines.length ? '' : null,
    ...statLines,
    '',
    fullUrl,
  ]
    .filter((l) => l !== null)
    .join('\n')
}
