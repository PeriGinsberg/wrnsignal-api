// scripts/workbook-from-html.ts
//
// Turn a per-client interview workbook written as HTML (the Workforce Ready Now
// workbook format: sections, numbered questions, answer starters, confirm-in-
// session boxes, notes, answer boxes) into the JSON content file that
// scripts/create-workbook.ts loads. Text is copied verbatim; inline bold is
// dropped to plain text. The mapping is the one Aiden Ginsberg's Bond Sports
// workbook was built with, and --check proves it still reproduces that file.
//
//   npx tsx scripts/workbook-from-html.ts <in.html> <out.json> --slug <slug> --company <c> --role <r> \
//     [--date YYYY-MM-DD] [--time <t>] [--interviewer-name <n>] [--interviewer-title <t>] [--location <l>] \
//     [--client-first-name <n>] [--coach-first-name <n>]
//   npx tsx scripts/workbook-from-html.ts --check     # rebuild Aiden's file and diff it against the committed JSON
//
// Mapping:
//   section            -> { id (from the <!-- NN NAME --> comment), number, title (h2), blocks }
//   .card with a list  -> list (bullets), titled by its label
//   .note              -> callout paleblue (titled when it has a label)
//   p.sub              -> heading
//   .q question        -> text lead (the question; a .tag such as "Must ask" becomes its label)
//     .starter         -> callout peach "Answer starter"
//     .confirm         -> callout paleblue "Confirm in session"
//     .note            -> callout paleblue
//     .ans textarea    -> field long, key = textarea id, label = the question, placeholder = the box label
//                         (a question with several boxes labels each one by its box label instead)
//     .card            -> list, titled by its label
//   p (no class)       -> text
//   .starter outside a question -> callout peach, titled by its label
//   .card with paragraphs -> text, the first one labelled by the card's label
//   table.tbl          -> table (header row from <thead>, cells as plain text)
//   dl of .term        -> table with no header: term, definition
//   table.tbl of inputs after an <sc-for> -> grid, one short answer per cell: rows from the
//                         sc-for's hint-placeholder-count, key from its list name, column keys
//                         from each input's aria-label, the .guide row as its guide

import { readFileSync, writeFileSync } from "node:fs"
import * as cheerio from "cheerio"
import type { Element } from "domhandler"

type Block = Record<string, unknown>

const clean = (s: string) => s.replace(/\s+/g, " ").trim()

/** Paragraph texts of an element, excluding its label (p.lab). */
function paragraphs($: cheerio.CheerioAPI, el: Element): string[] {
  const ps = $(el).children("p").not(".lab").toArray()
  if (ps.length) return ps.map((p) => clean($(p).text())).filter(Boolean)
  const t = clean($(el).clone().children(".lab").remove().end().text())
  return t ? [t] : []
}

function label($: cheerio.CheerioAPI, el: Element): string | null {
  const l = $(el).children(".lab").first()
  return l.length ? clean(l.text()) : null
}

function callout($: cheerio.CheerioAPI, el: Element, tone: string, fixedTitle?: string): Block {
  const title = fixedTitle ?? label($, el)
  return { type: "callout", tone, ...(title ? { title } : {}), body: paragraphs($, el).join("\n\n") }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

/**
 * A static table, or a grid when its cells are inputs. The HTML parser moves
 * an <sc-for> out of a <tbody>, so the row repeat arrives as the element
 * before the table, empty, and is passed in.
 */
function tableBlock($: cheerio.CheerioAPI, el: Element, repeat: Element | null): Block {
  const t = $(el)
  const heads = t.find("thead th").toArray().map((th) => clean($(th).text()))
  const inputs = t.find("tbody input").toArray()
  if (!inputs.length) {
    const rows = t.find("tbody tr").toArray().map((tr) => $(tr).children("td").toArray().map((td) => clean($(td).text())))
    return { type: "table", columns: heads, rows }
  }
  if (!repeat) throw new Error("A table of inputs with no <sc-for> to say how many rows")
  const rows = Number($(repeat).attr("hint-placeholder-count"))
  const key = String($(repeat).attr("list") ?? "").replace(/[{}\s]/g, "")
  if (!Number.isInteger(rows) || rows < 1 || !key) throw new Error("The <sc-for> needs list and hint-placeholder-count")
  // The first column is the row number; each other column is one input.
  const labels = heads.slice(1)
  if (inputs.length !== labels.length) throw new Error(`Grid has ${labels.length} headings but ${inputs.length} inputs`)
  const columns = inputs.map((inp, i) => ({
    key: slug(String($(inp).attr("aria-label") ?? "").replace(/\{\{[^}]*\}\}/g, "")),
    label: labels[i],
  }))
  const guideRow = t.find("tbody tr.guide").first()
  const guide = guideRow.length ? guideRow.children("td").toArray().slice(1).map((td) => clean($(td).text())) : undefined
  return { type: "grid", key, columns, rows, ...(guide ? { guide } : {}) }
}

function termsBlock($: cheerio.CheerioAPI, dl: Element): Block {
  const rows = $(dl).find(".term").toArray().map((d) => [clean($(d).find("dt").text()), clean($(d).find("dd").text())])
  return { type: "table", rows }
}

function cardBlocks($: cheerio.CheerioAPI, el: Element): Block[] {
  const n = $(el)
  const items = n.find("li").toArray().map((li) => clean($(li).text()))
  const title = label($, el)
  if (items.length && n.children("p").not(".lab").length) throw new Error(`A card with both paragraphs and a list: "${clean(n.text()).slice(0, 60)}"`)
  if (items.length) return [{ type: "list", style: "bullets", title, items }]
  const ps = paragraphs($, el)
  if (!ps.length) throw new Error(`An empty card: "${clean(n.text()).slice(0, 60)}"`)
  return ps.map((body, i) => ({ type: "text", ...(i === 0 && title ? { label: title } : {}), body }))
}

function questionBlocks($: cheerio.CheerioAPI, q: Element): Block[] {
  const out: Block[] = []
  // A "Must ask" style tag rides on the question as its label, not in its text.
  const head = $(q).find(".qhead").first()
  const tag = clean(head.find(".tag").first().text())
  const question = clean(head.find(".qt").first().clone().find(".tag").remove().end().text())
  const number = Number(clean(head.find(".qn").first().text())) || undefined
  out.push({ type: "text", size: "lead", ...(tag ? { label: tag } : {}), body: question })
  // Two boxes under one question ("Call 1", "Call 2") would read as the same
  // question twice, so each is labelled by its own box label instead.
  const several = $(q).children(".ans").length > 1
  let repeat: Element | null = null
  const walk = (children: Element[]) => {
    for (const child of children) {
      const c = $(child)
      if (c.hasClass("qhead")) continue
      if (child.tagName === "sc-for") { repeat = child; continue }
      if (c.hasClass("starter")) out.push(callout($, child, "peach", label($, child) ?? "Answer starter"))
      else if (c.hasClass("confirm")) out.push(callout($, child, "paleblue", "Confirm in session"))
      else if (c.hasClass("note")) out.push(callout($, child, "paleblue"))
      else if (c.hasClass("card")) out.push(...cardBlocks($, child))
      else if (c.is("table.tbl")) { out.push(tableBlock($, child, repeat)); repeat = null }
      else if (c.is("div") && !c.attr("class")) walk(c.children().toArray())
      else if (c.hasClass("ans")) {
        const box = clean(c.find("label").first().text())
        out.push({
          type: "field",
          key: c.find("textarea").first().attr("id"),
          input: "long",
          ...(number !== undefined && !several ? { number } : {}),
          label: several ? box : question,
          placeholder: several ? "Your answer" : box || "Your answer",
        })
      } else throw new Error(`Unhandled element in a question: <${child.tagName} class="${c.attr("class") ?? ""}">`)
    }
  }
  walk($(q).children().toArray())
  return out
}

function sectionBlocks($: cheerio.CheerioAPI, nodes: Element[]): Block[] {
  const out: Block[] = []
  let repeat: Element | null = null
  for (const node of nodes) {
    const n = $(node)
    if (n.hasClass("eyebrow") || n.hasClass("ht") || n.hasClass("rule")) continue
    if (node.tagName === "sc-for") { repeat = node; continue }
    if (n.hasClass("q")) out.push(...questionBlocks($, node))
    else if (n.hasClass("card")) out.push(...cardBlocks($, node))
    else if (n.hasClass("note")) out.push(callout($, node, "paleblue"))
    else if (n.hasClass("starter")) out.push(callout($, node, "peach", label($, node) ?? "Answer starter"))
    else if (n.is("p.sub")) out.push({ type: "heading", text: clean(n.text()) })
    else if (n.is("p") && !n.attr("class")) out.push({ type: "text", body: clean(n.text()) })
    else if (n.is("table.tbl")) { out.push(tableBlock($, node, repeat)); repeat = null }
    else if (n.is("dl")) out.push(termsBlock($, node))
    else if (n.is("div") && !n.attr("class")) out.push(...sectionBlocks($, n.children().toArray()))
    else throw new Error(`Unhandled element in a section: <${node.tagName} class="${n.attr("class") ?? ""}">`)
  }
  return out
}

export function parseWorkbookHtml(html: string) {
  const $ = cheerio.load(html)
  const titles = [...html.matchAll(/<!--\s*(\d\d)\s+([^-]+?)\s*-->\s*<section/g)].map((m) => ({ n: Number(m[1]), name: m[2] }))
  const sections = $("main > section").toArray().map((sec, i) => {
    const meta = titles[i]
    const id = (meta?.name ?? `section-${i + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    return {
      id,
      number: meta?.n ?? i + 1,
      title: clean($(sec).find("h2.ht").first().text()),
      blocks: sectionBlocks($, $(sec).children().toArray()),
    }
  })
  return {
    title: clean($("header h1").first().text()),
    eyebrow: clean($("header p.eyebrow").first().text()),
    subtitle: clean($("header h1").first().next("p").text()),
    sections,
  }
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

const fieldKeys = (sections: { blocks: Block[] }[]) =>
  new Set(sections.flatMap((s) => s.blocks.filter((b) => b.type === "field").map((b) => b.key as string)))

/** The summary page: interview details, the hook, and Tell Me About Yourself (present / past / future). */
function summaryFor(title: string, eyebrow: string, keys: Set<string>) {
  const blocks: Block[] = [{ type: "interview_details" }]
  if (keys.has("a_hook")) blocks.push({ type: "quick_answers", items: [{ label: "MY HOOK", field: "a_hook" }] })
  if (keys.has("a_tp") && keys.has("a_tpa") && keys.has("a_tf")) blocks.push({ type: "tmay", present: "a_tp", past: "a_tpa", future: "a_tf" })
  return { title, eyebrow, blocks }
}

function check() {
  const dir = "docs/workbooks-v1/workbooks-v1/"
  const want = JSON.parse(readFileSync(dir + "aiden-ginsberg_bond-sports-sdr.json", "utf8"))
  const got = parseWorkbookHtml(readFileSync(dir + "Ginsberg_BondSports_Workbook.html", "utf8"))
  let diffs = 0
  let knownBad = 0
  const strip = (s: any) => ({ number: s.number, title: s.title, blocks: s.blocks })
  if (got.sections.length !== want.sections.length) { console.log(`section count ${got.sections.length} vs ${want.sections.length}`); diffs++ }
  // Aiden's committed file has three corrupted field keys in "The Hard Stuff and
  // Comp" (the one-off converter looked up id="h1" and took the page's <h1>).
  // The correct keys are h1, h2, h3, which is what this converter emits.
  for (const sec of want.sections) for (const b of sec.blocks) {
    if (b.type === "field" && sec.id === "hard-stuff" && typeof b.key === "string" && b.key.length > 3) {
      b.key = `h${b.number}`
      knownBad++
    }
  }
  want.sections.forEach((ws: any, i: number) => {
    const a = JSON.stringify(strip(got.sections[i]))
    const b = JSON.stringify(strip(ws))
    if (a !== b) {
      diffs++
      console.log(`\nSECTION ${ws.number} "${ws.title}" differs`)
      const gb = got.sections[i]?.blocks ?? []
      ws.blocks.forEach((blk: any, j: number) => {
        if (JSON.stringify(gb[j]) !== JSON.stringify(blk)) console.log(`  block ${j}\n    want ${JSON.stringify(blk).slice(0, 220)}\n    got  ${JSON.stringify(gb[j] ?? null).slice(0, 220)}`)
      })
      if (gb.length !== ws.blocks.length) console.log(`  block count ${gb.length} vs ${ws.blocks.length}`)
    }
  })
  const sum = summaryFor(got.title, got.eyebrow, fieldKeys(got.sections))
  if (JSON.stringify(sum) !== JSON.stringify(want.summary)) { diffs++; console.log("summary differs", JSON.stringify(sum), JSON.stringify(want.summary)) }
  if (knownBad) console.log(`Note: ${knownBad} corrupted field key(s) in the committed Aiden file were compared as their correct keys (h1..h3).`)
  console.log(diffs ? `\n${diffs} difference(s)` : "Reproduces Aiden's workbook exactly (all sections, blocks and summary; section ids aside).")
  if (diffs) process.exit(1)
}

function main() {
  if (process.argv.includes("--check")) return check()
  const [inPath, outPath] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !(all[i - 1] ?? "").startsWith("--"))
  if (!inPath || !outPath) { console.error("Usage: workbook-from-html.ts <in.html> <out.json> --slug <slug> --company <c> --role <r> [...]"); process.exit(1) }
  const slug = arg("--slug"), company = arg("--company"), role = arg("--role")
  if (!slug || !company || !role) { console.error("--slug, --company and --role are required"); process.exit(1) }
  const parsed = parseWorkbookHtml(readFileSync(inPath, "utf8"))
  const fullName = clean(parsed.subtitle.split("·")[0] ?? "")
  const content = {
    schema_version: 1,
    slug,
    title: parsed.title,
    block_types_note: `Built from ${inPath.split(/[\\/]/).pop()} by scripts/workbook-from-html.ts, so the text is verbatim. Question -> text (lead). Answer starter -> callout peach 'Answer starter'. Note -> callout paleblue. Confirm in session -> callout paleblue 'Confirm in session'. Every question -> a long field labelled with the question; the HTML box label becomes its placeholder. Inline bold in the HTML is plain text here.`,
    client: { first_name: arg("--client-first-name") ?? fullName.split(/\s+/)[0], full_name: fullName },
    interview: {
      company, role,
      date: arg("--date"), time: arg("--time"),
      interviewer_name: arg("--interviewer-name"), interviewer_title: arg("--interviewer-title"),
      location: arg("--location"),
    },
    coach: { first_name: arg("--coach-first-name") ?? "Peri" },
    sections: parsed.sections,
    summary: summaryFor(parsed.title, parsed.eyebrow, fieldKeys(parsed.sections)),
  }
  writeFileSync(outPath, JSON.stringify(content, null, 1) + "\n", "utf8")
  const fields = fieldKeys(parsed.sections)
  console.log(`Wrote ${outPath}: "${content.title}" for ${fullName}, ${parsed.sections.length} sections, ${fields.size} fields`)
  for (const s of parsed.sections) {
    const f = s.blocks.filter((b) => b.type === "field").length
    const st = s.blocks.filter((b) => b.type === "callout" && b.title === "Answer starter").length
    const cf = s.blocks.filter((b) => b.type === "callout" && b.title === "Confirm in session").length
    console.log(`  ${String(s.number).padStart(2)}. ${s.title}  (${f} fields, ${st} starters, ${cf} confirm)`)
  }
}

main()
