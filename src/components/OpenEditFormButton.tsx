'use client'

export default function OpenEditFormButton() {
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent('prometheus-open-edit'))}
      className="btn-accent-outline btn-sm"
    >
      ✏ Edit offer
    </button>
  )
}
