import type { MetadataRoute } from 'next'

// Prometheus is a private internal tool; the public case-study showcases are
// unlisted, unguessable links meant only for people we send them to. Nothing
// here should be crawled or indexed. The showcase pages ALSO carry a per-page
// noindex/nofollow meta tag + x-robots-tag header — this is the matching
// robots.txt belt-and-suspenders.
//
// One exception: the strategist status board (/status, /api/status). People
// paste those links into an AI assistant to upload ads, and an assistant that
// fetches a page for its user may check robots.txt first. So that one path is
// open to every agent, whatever it calls itself. Nothing is exposed by this:
// the links are unguessable, nothing links to them, and every page there
// still answers noindex.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/status/', '/api/status/'],
      disallow: '/',
    },
  }
}
