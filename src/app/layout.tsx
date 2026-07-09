import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Prometheus CRM",
  description: "Common Thread Collective — Prometheus Project Studio",
};

// Read the persisted theme and apply the class BEFORE React hydrates so the
// browser never paints the wrong background. Runs sync, blocks first paint by
// a few microseconds — a fair trade to avoid a jarring dark→light flash.
const themeInitScript = `(function() {
  try {
    var t = localStorage.getItem('prometheus-theme');
    if (t === 'light') document.documentElement.classList.add('theme-light');
  } catch (e) { /* localStorage blocked — stick with default dark */ }
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
