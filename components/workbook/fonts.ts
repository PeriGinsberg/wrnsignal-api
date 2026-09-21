// components/workbook/fonts.ts
// The workbook's two faces (spec: Fraunces for headlines, numbers and big
// quotes; Instrument Sans for everything else). Loaded here, not in the root
// layout, so no other screen pays for them.

import { Fraunces, Instrument_Sans } from "next/font/google"

export const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  style: ["normal", "italic"],
  variable: "--wb-font-serif",
  display: "swap",
})

export const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--wb-font-sans",
  display: "swap",
})

export const workbookFontClass = `${fraunces.variable} ${instrumentSans.variable}`
