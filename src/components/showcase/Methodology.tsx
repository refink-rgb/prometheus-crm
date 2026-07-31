// Where the figures come from: attribution model, comparison window, and which
// numbers are platform-reported vs blended business reporting. Deliberately
// quiet and last, but present — it is what lets a sceptical reader trust the
// rest of the page.
export default function Methodology({ text }: { text?: string | null }) {
  if (!text?.trim()) return null

  return (
    <section aria-label="Methodology" style={{ padding: '0 0 64px' }}>
      <div className="pe-container">
        <div
          style={{
            borderTop: '1px solid var(--pe-border)',
            paddingTop: 20,
            maxWidth: 860,
          }}
        >
          <p
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--pe-muted)',
              margin: '0 0 10px',
            }}
          >
            Methodology
          </p>
          <p style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--pe-muted)', margin: 0 }}>{text}</p>
        </div>
      </div>
    </section>
  )
}
