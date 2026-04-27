import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
// Leaflet stylesheets must load *before* globals.css so our themed popup /
// cluster overrides win at equal specificity. (Importing them from inside the
// dynamically-loaded MapComponent puts them last in the cascade and Leaflet's
// vanilla white popup styles override ours.)
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NYC Subway Live",
  description: "Real-time NYC subway map powered by MTA GTFS-RT feeds",
};

// Inline FOUC-prevention script. Runs before React hydrates so the right
// theme class is on <html> for the very first paint. Mirrors the resolution
// logic in lib/theme.ts (stored preference wins, otherwise system pref).
const themeBootstrap = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeBootstrap }}
        />
      </head>
      <body className="h-full bg-white dark:bg-gray-950">{children}</body>
    </html>
  );
}
