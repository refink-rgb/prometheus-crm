import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,

  // Tree-shake heavy packages that would otherwise ship whole modules to the
  // browser bundle. lucide-react is the biggest win — un-optimized it ships
  // the entire icon set.
  experimental: {
    // Client router cache: re-visiting a page within 30s reuses the last
    // payload instead of re-rendering on the server (an ocean round-trip from
    // SEA). Server Actions call revalidatePath, which busts this cache, so
    // edits still show up immediately.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },

    optimizePackageImports: [
      'lucide-react',
      'recharts',
      '@dnd-kit/core',
      '@dnd-kit/utilities',
      '@dnd-kit/sortable',
    ],
  },

  // Whitelist the hosts we serve images from so <Image /> can optimize them.
  // Any Supabase Storage bucket on our project + Google Drive public links
  // (used by creative assets) are the two sources today.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'drive.google.com',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
    ],
  },
};

export default nextConfig;
