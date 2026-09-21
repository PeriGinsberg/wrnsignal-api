"use client"

// components/workbook/WorkbookFrame.tsx
// Scopes the workbook style: its fonts and stylesheet apply inside this frame
// only, so the coach shell around the Workbooks tab keeps its own theme.

import React, { type ReactNode } from "react"
import { workbookFontClass } from "./fonts"
import { WORKBOOK_CSS } from "./styles"

export function WorkbookFrame({ children, page = true }: { children: ReactNode; page?: boolean }) {
  return (
    <div className={`wb-root ${workbookFontClass}${page ? " wb-page" : ""}`}>
      <style>{WORKBOOK_CSS}</style>
      {children}
    </div>
  )
}
