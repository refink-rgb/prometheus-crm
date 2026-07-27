import type { MetadataRoute } from 'next'

// Prometheus is a private internal tool; the public case-study showcases are
// unlisted, unguessable links meant only for people we send them to. Nothing
// here should be crawled or indexed. The showcase pages ALSO carry a per-page
// noindex/nofollow meta tag + x-robots-tag header — this is the matching
// robots.txt belt-and-suspenders.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
    },
  }
}
