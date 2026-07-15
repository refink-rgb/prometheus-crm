// Extracted from BrandCard.tsx, where this logic lived alongside near-identical
// copies in portal/[token]/page.tsx and NotesThread.tsx. Editor chips need the
// same treatment, so it lives here now.
//
// Deliberately not a client component: it's pure presentation with no state, so
// it renders fine inside both server and client trees.

const AVATAR_COLORS = [
  '#F97316', '#3B82F6', '#10B981', '#8B5CF6',
  '#EC4899', '#F59E0B', '#06B6D4', '#EF4444',
]

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function hashToColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

export default function Avatar({
  name,
  size = 28,
  title,
}: {
  name: string
  size?: number
  title?: string
}) {
  return (
    <div
      title={title ?? name}
      aria-hidden={title ? undefined : true}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: hashToColor(name),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontWeight: 700,
        // Keeps the initials proportional across the 18–40px range we use.
        fontSize: Math.max(9, Math.round(size * 0.36)),
        letterSpacing: '0.02em',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {initials(name)}
    </div>
  )
}
