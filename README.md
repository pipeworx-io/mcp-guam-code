# @pipeworx/guam-code

Guam Code Annotated (GCA) — Guam territorial statutes, by citation and by
topic/keyword search. Keyless.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1856+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

## Tools

- `gu_statute(citation, title?)` — full text of a GCA section by citation
  ("9 GCA 16.30" is Aggravated Murder Defined; "21 GCA 33101" is who may
  take an acknowledgment of a deed). Resolves the citation to its one
  chapter PDF, fetches it live, and extracts the text. `title` is only
  needed if not already embedded in `citation`.
- `gu_search(query, title?, limit?)` — topic/keyword search over section and
  chapter catchlines (not full statutory prose — see below), optionally
  restricted to one Title (1-22).

## Auth

Keyless.

## Source and shape

The Compiler of Laws (Judiciary of Guam, `col.guamcourts.gov`) publishes the
GCA as ~800 per-CHAPTER PDFs, linked from one static HTML page: 22
collapsible Title panels, each listing its Chapters. There is no per-title
listing, no search API, and no site-wide section index (confirmed live) —
the same gap `mcps/north-dakota-code` hit for the Century Code. That page is
baked ONCE (title/chapter/catchline/PDF URL) by `scripts/bake-index.mjs`.

Unlike North Dakota, the GCA index page does not also enumerate every
section. But every sampled chapter PDF opens with its own embedded table of
contents — a run of `§ <chapter>.<nn>. Catchline.` headings — so
`scripts/bake-sections.mjs` fetches all ~800 chapter PDFs once more and
bakes a section-level catchline index (15,760 rows) from that TOC block.
`gu_search` reads it; `gu_statute` never trusts it for the text it
returns — it re-derives section boundaries fresh from the live PDF on every
call.

### Refresh path

Re-run both whenever the Compiler of Laws amends the GCA enough to be worth
re-baking (run the chapter index first — the section bake reads it):

```
node mcps/guam-code/scripts/bake-index.mjs > mcps/guam-code/src/gu-index-data.ts
node --experimental-strip-types mcps/guam-code/scripts/bake-sections.mjs > mcps/guam-code/src/gu-section-data.ts
```

The section bake needs `--experimental-strip-types` because it imports the
pack's own TypeScript extractor directly (no tsx/ts-node dependency in this
repo) — nothing at runtime needs that flag, only this one offline script.
Budget a few minutes: ~800 HTTP fetches at modest concurrency, as a courtesy
to `col.guamcourts.gov` rather than because it rate-limits.

Both baked modules are combined by `src/gu-baked-data.ts` (a plain
re-export) into the ONE data module `workers/gateway/src/pack-baked-indexes.json`
points at for this pack — the gateway uploads its exports to KV at deploy
and injects them as `args._bakedIndex`, never as a module-scope import (see
`index.ts`'s `ensureIndex`; fleet #2754 took the gateway down the one time a
baked table was value-imported into every isolate).

## Two citation conventions, both real

Newer, recodified titles (9 GCA, the Criminal & Correctional Code, adapted
from the 1977 Model Penal Code) cite "chapter.section" with a dot — "9 GCA §
16.30" is Aggravated Murder. Older titles (e.g. 21 GCA Ch. 33, Proof and
Acknowledgments of Instruments) concatenate chapter and a zero-padded
section number with no separator — "21 GCA § 33101" is chapter 33, section
101. `gu_statute` accepts either form (see `parseGuCitation` in
`src/index.ts`). The chapter/section boundary for the no-dot form is
genuinely ambiguous from the digit string alone (chapter numbers vary in
length); it is resolved by picking the longest known chapter number, for the
given Title, that is a literal prefix of the citation — correct in every
case sampled.

## `shared/src/pdf-text.ts` needed real fixes — folded in, fork deleted (fleet #2904)

Guam's chapter PDFs originally defeated the shared extractor in ways it did
not yet handle, and this pack was built the same week another pack (#2884,
New Mexico) was independently editing that shared file — so the fixes
initially lived in `src/gu-pdf-extract.ts`, a pack-local fork of
`shared/src/pdf-text.ts`, with a loud header comment for whoever next
touched the shared extractor to fold them in (nothing about them was
Guam-specific). That fold-in happened in fleet #2904: the fork is gone, this
pack now calls `extractPdfText` from `@pipeworx/shared` directly, and all
three fixes below live in `shared/src/pdf-text.ts` itself, benefiting every
other PDF pack (kentucky-code, north-dakota-code, wyoming-code,
new-mexico-code), not just this one:

1. **Literal strings weren't routed through the font decoder.** Guam's
   producer (Neevia Document Converter, from Word) writes some non-WinAnsi
   subset fonts' text as parenthesized LITERAL strings (`(abc)Tj`) rather
   than hex (`<...>Tj`). The shared extractor's `decodeRun` passed a literal
   run through unchanged — correct for WinAnsi, but for these fonts the raw
   bytes are a tiny, arbitrary code space meaningful only via the font's own
   `/ToUnicode` CMap, which the shared code already had the machinery for
   (built for North Dakota) but only wired to the HEX-string path. Confirmed
   live: unfixed, `§ 16.10` extracted as control-character noise; fixed, it
   reads correctly.
2. **A declared `/Length` a few bytes long.** Several older chapter PDFs
   ("MS Word for Windows Document" producer — an earlier era than the
   Neevia-converted ones above) declare a `/Length` 1+ bytes longer than
   their actual deflate stream. Python's zlib tolerates the trailing byte
   silently; Node/Workers' strict `DecompressionStream` throws
   `ERR_TRAILING_JUNK_AFTER_STREAM_END`. Now retried with the stream's tail
   trimmed a byte at a time (up to 4) before giving up.
3. **Crash-adjacent, found while baking the section index.** The shared
   `inflate()` helper's two stream writes were fire-and-forget
   (`void writer.write(...)`); a malformed deflate stream (the same PDFs #2
   above describes) rejected that promise as an UNHANDLED rejection,
   invisible to any caller's try/catch and fatal to the whole process —
   crashed `scripts/bake-sections.mjs` outright, mid-run. Fixed by attaching
   a no-op `.catch()` to each write/close; the real failure still surfaces
   through `reader.read()`, which the caller already handles.

**One delta stayed pack-local, in `src/gu-font-cmap-fix.ts`, because it
genuinely IS Guam-specific:** one embedded symbol font per chapter PDF
(`...+WPTypographicSymbols`, used only for curly quotes) carries a
`/ToUnicode` CMap that maps its two codes to U+0041 ('A') and U+0040 ('@')
instead of the left/right curly quote it visually renders as. Confirmed by
eye: "ADirector of Public Safety@" in raw extraction is "“Director of Public
Safety”" with those two codes substituted back — the obviously intended
reading, reproduced by any PDF viewer's own copy-paste. This is a defect in
Guam's own published PDF, not something a general-purpose extractor could
derive, so it is passed into `extractPdfText` via its new `fontCMapOverride`
option — a generic hook (match a font's own dictionary text, optionally
return a replacement `/ToUnicode` map) with nothing Guam-specific about the
mechanism itself, available to any future pack that hits a similarly broken
source PDF.

## Four capabilities — two available, two are not

- **Citation lookup** — available (`gu_statute`).
- **Topic/keyword search** — available (`gu_search`), over official
  CATCHLINES (section + chapter name), not full statutory prose. Coverage
  is best-effort: catchlines are derived from each chapter PDF's own table
  of contents rather than a separate official index, so an unusually
  formatted chapter can be under-represented.
- **Amendments/enactment history** — embedded in `gu_statute`'s `text`
  field as the statute's own "SOURCE:" line (e.g. "Enacted 1977 as 16.30;
  amended by P.L. 14-125..."), not split out as a separate field — the GCA
  does not mark it up distinctly enough to parse reliably across both PDF
  eras sampled.
- **Historical version** (a section's text as it read before an amendment)
  — **not available**. `col.guamcourts.gov` serves the current text only;
  no per-year or per-session archive was found.

## Known rough edge: page-furniture noise at a chapter's last section

`gu_statute` strips the repeating running header ("9 GCA CRIMES AND
CORRECTIONS CH. 16 CRIMINAL HOMICIDE 1") and the "COL<digits>" stamp every
page carries, self-derived from the chapter text's own first occurrence.
Older-era PDFs (the "MS Word for Windows Document" producer, #2 above)
sometimes extract that header with no inter-word spacing ("21GCAREAL
PROPERTY" rather than "21 GCA REAL PROPERTY"), which the stripping regex —
anchored on `GCA` preceded by whitespace — does not match. The statutory
text itself is unaffected; only a section that happens to be the LAST one on
a page, in one of these older chapters, can carry a trailing fragment of the
next page's header/footer. Cosmetic, not a correctness defect.

## Citations

Give `citation` as `"9 GCA 16.30"`, `"9 GCA § 16.30"`, `"21 GCA 33101"`, or a
bare section (`"16.30"` / `"33101"`) with `title` passed separately.

## Data sources

- `https://col.guamcourts.gov/guam-code-annotated/guam-code-annotated` — the
  Title/Chapter index (one collapsible page). Baked once into
  `src/gu-index-data.ts`; never fetched per call.
- `https://col.guamcourts.gov/sites/default/files/9gc016.pdf` — one
  chapter's full statutory text (here, 9 GCA Chapter 16, Criminal Homicide
  — swap the filename for any other chapter). `gu_statute` fetches this
  live on every call and extracts the target section out of it. The same
  ~800 chapter PDFs are also fetched once, offline, by
  `scripts/bake-sections.mjs` to build the catchline search index.

Both are plain, keyless, server-rendered HTML/PDF — no login, no JS, no
rate-limit observed during development.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "guam-code": {
      "url": "https://gateway.pipeworx.io/guam-code/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/guam-code/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1856+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/gu_statute \
  -H 'Content-Type: application/json' \
  -d '{"citation":"9 GCA 16.30"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/gu_statute`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Run it from npm

`@pipeworx/mcp-guam-code` is a local stdio bridge to the Pipeworx gateway: your MCP client
starts it with `npx`, and it forwards every call to the same
`https://gateway.pipeworx.io/guam-code/mcp` endpoint shown above. It needs network access;
there is no offline mode.

```json
{
  "mcpServers": {
    "guam-code": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-guam-code"]
    }
  }
}
```

Without a key it calls anonymously, capped at 50 calls a day. A free account
raises that to 200 a day: get a key at https://pipeworx.io/signup and add
`"env": { "PIPEWORX_API_KEY": "<your key>" }` to the server entry.
The key is sent as a Bearer token, the same way a hosted connection sends it,
so calls are metered and billed exactly as they are there.

It lists **only** this pack's tools by default. Set `PIPEWORX_META_TOOLS=1` to
also list `ask_pipeworx` and the other gateway-wide tools.

Behind an HTTPS proxy: Node's built-in `fetch` does not read `HTTPS_PROXY` by
default. Newer Node releases honour it when `NODE_USE_ENV_PROXY=1` is set; check
your Node version's documentation.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Guam Code data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
