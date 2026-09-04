// Human-readable timestamps for things people say to each other — comments,
// notes, revisions. Deliberately NOT in eastern.ts: that file is the app's
// calendar authority and answers "what day is it for the business", always in
// Eastern. This answers "when did this land, in front of the person reading
// it", so it stays in the viewer's own timezone.

// Date AND time. Four comments arriving on one creative are almost always one
// client working through it in a single sitting, and a bare date cannot show
// the order they came in — which is the thing you need when two of them
// contradict each other.
export function commentStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Versions get the same treatment for the same reason: two edits uploaded on
// the same day are indistinguishable without the clock.
export const revisionStamp = commentStamp
