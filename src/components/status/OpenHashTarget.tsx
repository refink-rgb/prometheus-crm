'use client'

// The home page links each project row to its card on the client page
// (#p-<id>). A launched project's card sits inside a closed <details>, which
// the browser will not open or scroll to on its own, so do both once on load.

import { useEffect } from 'react'

export default function OpenHashTarget() {
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (!id) return
    const el = document.getElementById(id)
    if (!el) return
    const details = el.closest('details')
    if (details && !details.open) details.open = true
    el.scrollIntoView({ block: 'start' })
  }, [])
  return null
}
