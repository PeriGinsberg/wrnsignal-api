#!/usr/bin/env tsx
// The service-account key loader.
// Run: npx tsx lib/drive/key.test.ts
//
// Written after a production failure whose entire symptom was:
//
//   error:1E08010C:DECODER routines::unsupported
//
// That message says nothing about what is wrong with the key, and the key
// cannot be printed to find out, so the only defence is accepting every shape
// an environment might hand us. Each case below is signed with, not merely
// string-compared: a key that looks right and cannot sign is the bug.

import { createSign, generateKeyPairSync } from "node:crypto"
import { normalizePrivateKey } from "./client"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}`) }
}

// A real key, generated here so no secret lives in the repo.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }) as string

/** The thing that actually matters: can OpenSSL sign with what came back. */
function canSign(key: string): boolean {
  try {
    const s = createSign("RSA-SHA256")
    s.update("signal")
    s.sign(key)
    return true
  } catch {
    return false
  }
}

console.log("the shapes an environment hands us")
ok("a clean PEM signs", canSign(normalizePrivateKey(PEM)))
ok("escaped newlines sign", canSign(normalizePrivateKey(PEM.replace(/\n/g, "\\n"))))
ok("wrapped in double quotes signs", canSign(normalizePrivateKey(`"${PEM.replace(/\n/g, "\\n")}"`)))
ok("wrapped in single quotes signs", canSign(normalizePrivateKey(`'${PEM.replace(/\n/g, "\\n")}'`)))
ok("double-escaped newlines sign", canSign(normalizePrivateKey(PEM.replace(/\n/g, "\\\\n"))))
ok("CRLF signs", canSign(normalizePrivateKey(PEM.replace(/\n/g, "\r\n"))))
ok("leading and trailing whitespace signs", canSign(normalizePrivateKey(`\n   ${PEM}   \n`)))
ok("a key with no trailing newline signs", canSign(normalizePrivateKey(PEM.trimEnd())))
ok("quoted AND CRLF AND no trailing newline signs",
  canSign(normalizePrivateKey(`"${PEM.trimEnd().replace(/\n/g, "\r\n").replace(/\r\n/g, "\\n")}"`)))

console.log("\nthe result is a real PEM")
const out = normalizePrivateKey(`"${PEM.replace(/\n/g, "\\n")}"`)
ok("starts with the PEM header", out.startsWith("-----BEGIN PRIVATE KEY-----"))
ok("ends with a newline", out.endsWith("\n"))
ok("contains no literal backslash-n", !out.includes("\\n"))
ok("contains no quotes", !out.includes('"') && !out.includes("'"))

console.log("\nrubbish still fails, rather than failing later")
ok("an empty value cannot sign", !canSign(normalizePrivateKey("")))
ok("a non-key cannot sign", !canSign(normalizePrivateKey("not-a-key")))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
