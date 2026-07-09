import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,

  // Tree-shake heavy packages that would otherwise ship whole modules to the
  // browser bundle. lucide-react is the biggest win — un-optimized it ships
  // the entire icon set.
  experimental: {
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
