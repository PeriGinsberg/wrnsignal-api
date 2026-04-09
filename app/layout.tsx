import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "SIGNAL Dashboard",
  description: "Workforce Ready Now — JobFit, Positioning, Cover Letter, Networking",
};

// Explicit viewport. Next.js auto-injects "width=device-width" by default
// but does NOT include "initial-scale=1", which causes some browsers to
// render pages at a default scale that makes content look tiny until the
// user manually zooms. It also breaks 100vh calculations on mobile Safari
// where the dynamic toolbar causes the visual viewport to shrink mid-scroll.
// Declaring viewport explicitly here fixes both issues for every page
// under this layout (dashboard, tracker, profile, etc.).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
