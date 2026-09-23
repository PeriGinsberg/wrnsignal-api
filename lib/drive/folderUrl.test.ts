#!/usr/bin/env tsx
// Pasted-link parsing for the Networking Plan folder. Pure, so no network.
// Run: npx tsx lib/drive/folderUrl.test.ts

import { parseDriveFolderUrl, driveFolderUrl, driveFileUrl } from "./folderUrl"

let pass = 0
let fail = 0
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`) }
}
const ID = "1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv"
const isError = (r: unknown) => typeof (r as any).error === "string"

console.log("the forms a coach actually pastes")
check("plain folder link", parseDriveFolderUrl(`https://drive.google.com/drive/folders/${ID}`), { id: ID })
check("with the account prefix", parseDriveFolderUrl(`https://drive.google.com/drive/u/0/folders/${ID}`), { id: ID })
check("with a sharing query", parseDriveFolderUrl(`https://drive.google.com/drive/folders/${ID}?usp=sharing`), { id: ID })
check("with a trailing slash", parseDriveFolderUrl(`https://drive.google.com/drive/folders/${ID}/`), { id: ID })
check("surrounding whitespace", parseDriveFolderUrl(`  https://drive.google.com/drive/folders/${ID}  `), { id: ID })
check("no scheme", parseDriveFolderUrl(`drive.google.com/drive/folders/${ID}`), { id: ID })
check("a bare id", parseDriveFolderUrl(ID), { id: ID })

console.log("\nthe wrong thing pasted, each with its own fix")
check("a file link is refused", isError(parseDriveFolderUrl("https://drive.google.com/file/d/abc123def456/view")), true)
check("...and says it is a file", String((parseDriveFolderUrl("https://drive.google.com/file/d/abc123def456/view") as any).error).includes("file, not a folder"), true)
check("a doc link is refused", isError(parseDriveFolderUrl("https://docs.google.com/document/d/abc123def456/edit")), true)
check("drive root is refused", isError(parseDriveFolderUrl("https://drive.google.com/drive/u/0/my-drive")), true)
check("a non-google link is refused", isError(parseDriveFolderUrl("https://dropbox.com/folders/abc")), true)
check("nonsense is refused", isError(parseDriveFolderUrl("the networking folder")), true)
check("empty is refused", isError(parseDriveFolderUrl("")), true)
check("null is refused", isError(parseDriveFolderUrl(null)), true)

console.log("\na lookalike host does not pass")
check("google.com.evil.test is refused", isError(parseDriveFolderUrl("https://drive.google.com.evil.test/drive/folders/" + ID)), true)

console.log("\ncanonical urls")
check("folder url", driveFolderUrl(ID), `https://drive.google.com/drive/folders/${ID}`)
check("file url", driveFileUrl(ID), `https://drive.google.com/file/d/${ID}/view`)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
