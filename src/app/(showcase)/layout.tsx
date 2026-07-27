// Minimal layout for the public case-study showcases. Unlike the (public) review
// pages, the showcase is a static, no-auth marketing page — it needs none of the
// ToastProvider / ConfirmDialogHost client machinery those pages use (and reusing
// that layout introduced a client-only portal hydration mismatch). Keeping this
// group self-contained gives the showcase a clean, error-free first load.
export default function ShowcaseLayout({ children }: { children: React.ReactNode }) {
  return children
}
