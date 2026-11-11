// Pins on statics: shared by the staff detail page and the client review link.

/** Pin numbers for the pinned notes on one static, in the order they were left. */
export function pinNumbers(comments: { id: string; pin_x: number | null; pin_y: number | null }[]): Map<string, number> {
  return new Map(comments.filter(c => c.pin_x != null && c.pin_y != null).map((c, i) => [c.id, i + 1]))
}

/** A numbered dot on a static, at a percentage of its width and height. */
export function PinDot({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <span aria-hidden style={{
      position: 'absolute', left: `${x}%`, top: `${y}%`, width: 22, height: 22, margin: '-11px 0 0 -11px', borderRadius: '50%',
      background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,0.4)', pointerEvents: 'none',
    }}>{label}</span>
  )
}
