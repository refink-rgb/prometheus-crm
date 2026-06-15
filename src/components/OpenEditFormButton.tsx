'use client'

export default function OpenEditFormButton() {
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent('prometheus-open-edit'))}
      style={{
        fontSize: 12, fontWeight: 500, color: 'var(--accent)',
        background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.25)',
        borderRadius: 7, padding: '5px 12px', cursor: 'pointer',
      }}
    >
      ✏ Edit offer
    </button>
  )
}
