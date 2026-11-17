import type { MetadataRoute } from 'next'

// Prometheus is a private internal tool; the public case-study showcases are
// unlisted, unguessable links meant only for people we send them to. Nothing
// here should be crawled or indexed. The showcase pages ALSO carry a per-page
// noindex/nofollow meta tag + x-robots-tag header — this is the matching
// robots.txt belt-and-suspenders.
//
// One exception: the strategist status board (/status, /api/status). People
// paste those links into an AI assistant to upload ads, and an assistant
// fetching a page for its user checks robots.txt first. Those user-triggered
// fetchers may read that one path. They are not crawlers: the links are
// unguessable, nothing links to them, and every page there is still noindex.
// Search and training crawlers stay blocked everywhere.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', disallow: '/' },
      {
        userAgent: ['ChatGPT-User', 'Claude-User', 'Perplexity-User'],
        allow: ['/status/', '/api/status/'],
        disallow: '/',
      },
    ],
  }
}
