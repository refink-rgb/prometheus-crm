import { cookies } from 'next/headers'
import { cache } from 'react'

// Which generation of the interface to render.
//
// This is a COOKIE, deliberately, not localStorage like ThemeToggle: these are
// server components, so the server has to know the version before it renders a
// single node. localStorage is only readable after hydration, which would mean
// shipping v1 and then flipping to v2 in the browser — a guaranteed flash and
// double render.
//
// The contract for anything built behind this flag: page.tsx keeps ONE copy of
// the queries, permissions and server actions, and branches only on which view
// component receives the data. Forking whole routes makes the two versions
// drift, and every bug then has to be fixed twice.
export type UiVersion = 'v1' | 'v2'

export const UI_VERSION_COOKIE = 'prometheus-ui'
export const DEFAULT_UI_VERSION: UiVersion = 'v1'

function parse(value: string | undefined): UiVersion {
  return value === 'v2' ? 'v2' : DEFAULT_UI_VERSION
}

// cache() so every component in one render agrees on the version — a layout
// reading v2 while a child reads v1 would produce a spliced-together page.
export const getUiVersion = cache(async (): Promise<UiVersion> => {
  const store = await cookies()
  return parse(store.get(UI_VERSION_COOKIE)?.value)
})
