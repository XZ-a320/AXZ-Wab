# AXZ 改版评审 · Revamp Panel — 2026-08-15

Eight seats, one site: `xiaobrook.com/axz/` (zh) + `/axz/en/`.
Reviewed against the built output at `axz/` and the source at `axz-src/`.

---

## 0. The panel's one shared finding

**This site does not need a revamp. It needs the airline turned on.**

The 2026-08-07 rebuild is genuinely good work: one design system, two line
weights, no radii, no shadows, a computed contrast table, five build gates, real
subset CJK type, and a 备注 column lifted out of the owner's own C# logger. A
"full revamp" that restyles this would be a net loss.

What the site actually lacks is **verbs**. Today it is a museum: it *documents*
an airline in five sectors and then stops. Nothing on it can be flown, planned,
dispatched, scored, or taken away. Every panel below is a verb.

Scores are out of 10.

---

## 1. Seat-by-seat

### 创意总监 / Creative Director — 8.0
The typographic voice is settled and unusual: mono display at `clamp(52px,11vw,148px)`,
a red serif marginal hand, hard 6px print offset used exactly once. Nobody else's
virtual-airline site looks like this.

Where it thins out: **the page tails off badly.** Section heights on the home
page are 3264px (航线), 3459px (机队), then 755px (全纪录), 782px (热点), 435px
(留言). The reader spends 68% of the scroll in two sectors and then falls off a
cliff through three stubs. Sectors 03–05 read as afterthoughts because
structurally they *are*.

The masthead is also the only place the brand performs. After the fold the site
never returns to the wordmark, the cyan, or the FLY ON TIME line.

### 设计工程师 / Design Engineer — 7.5
Two verified defects:

1. **`axz-src/css/pages.css` lines 477–554 are dead weight.** Lines 477–525 are a
   verbatim duplicate of the flight-strip block at 351–400. Lines 527–554 are a
   *stale, conflicting* `.masthead__ship` block from the SVG era, and because it
   comes later in the file it beats the shipped `@supports` mask block at 418–468.
2. **The masthead aircraft is measured wrong as a result.** Computed box is
   589 × 487 px = ratio **1.208**; the mask's natural ratio is 1205/1041 = **1.158**.
   The intended `height: min(97%, 620px)` is fighting a leftover
   `width: clamp(320px, 46vw, 760px)`. `mask-size: contain` letterboxes it so the
   drawing isn't visibly stretched — but the box is wrong, ~78 lines of dead CSS
   ship to every visitor, and `.masthead__ship svg { … }` targets an element that
   no longer exists.

Otherwise the front-end discipline is high: no-JS complete, `data-anim` opt-in so
a failed measurement renders the finished drawing, `vector-effect: non-scaling-stroke`
so the A321 doesn't get a heavier outline than the 737 for being wider.

### 模拟飞行社区 / Flight-Sim Community — 5.5 ← lowest score, and the important one
"I'm the target reader. I can't *do* anything here."

- Four flight numbers, no **timetable**. AXZ001–004 exist as ATC strips; there is
  no departure board, no block times against a clock, no local time at KSFO/ZSPD.
- Two route pairs, no **map**. The route "charts" are the owner's raster
  screenshots. Nothing shows KSFO↔KSNS and ZSPD↔ZSNJ as one network.
- A **logbook reader** that reads `.axzlog` — but nothing that helps you *make*
  a flight worth logging. No dispatch, no fuel, no payload, no V-speeds.
- **One external link on the whole site** (`route.hkrscoc.com`) plus a GitHub
  release. No SimBrief, no charts, no METAR, no sim-community pointers.
- **B-1717 is a Minecraft联动机 "发誓永不退涂"** — the single most shareable fact
  on this site — and it has **no image, no livery, no panel.** It's one paragraph
  in a ledger row.

### 交互与动效 / Interaction & Motion — 7.0
The shipping rule in `base.css` ("if a motion cannot be removed and leave a
complete, legible, information-equivalent static state, it is not shipped") is the
correct rule and it is actually honoured. Stroke-draw airframes, the clip-wipe
masthead, the altitude profile — all have finished static states, all sit behind
both `prefers-reduced-motion` and the manual stop toggle.

The gap: **all motion is entrance motion.** Everything animates once on reveal and
is then inert forever. There is no motion that *responds*. A site about aircraft
in flight has nothing in continuous, meaningful movement, and nothing the reader
can push.

### 无障碍与性能 / Accessibility & Performance — 9.0
Best-in-class for a hobby site and the thing least in need of change. WCAG 2.2 AA
targeted, 33 contrast pairings computed rather than estimated, axe over 10
documents × 2 themes, keyboard walked page by page, VoiceOver proofed, 375px
verified. Per-role per-language font subsets: 196 KB zh / 48 KB en, against
17.7 MB unsubset.

**This is the constraint every new feature must clear, not a section to improve.**
A canvas mini-game with no keyboard path and no static equivalent fails the site's
own stated rule and must not ship.

### 中英文编辑 / Bilingual Content — 8.5
zh is the single source of truth; en is generated and gate-checked against 16
locked renderings and 25 banned strings. 313 Chinese phrase runs from the original
site are verified present on every build. The deadpan/absurd pairing (重大事件 beside
搞笑黑历史 on one baseline) is the best idea on the site.

Constraint for everything below: **new features mean new keys in `zh.json` *and*
`en.json`, plus gate coverage.** No new English string may be written directly.

### 产品与游戏设计 / Product & Games — 6.0
The brief invites a mini-game. Most virtual-airline sites bolt on a generic flight
game and it reads as filler. The one that belongs here is the one that **writes a
备注**.

The site's running joke is B-737X's landings — 落地风格稳健偏"重"、跑道震动器、
温柔重着陆、跑道按摩师、首飞第一天就发生了重着落, and the A321 忘放襟翼. A landing
scorer whose *output is a red serif remark cell in the site's own voice* isn't a
bolt-on; it is the 备注 column becoming interactive. That is the bullseye.

### 站主代表 / The Owner's Advocate (XZ-a320) — n/a
Two standing rules from the last pass hold: it stays **his** site in **his** voice,
and the C# tooling in the repo is the source of design authority, not decoration.
Anything added should feel like something the airline would issue — a release, a
board, a strip — not like a web toy dropped on top.

**Locked, non-negotiable** (build gates enforce): 31100 英尺 is correct;
跑道震动器 → "the Runway Shaker"; 搬砖人 → "grunt work"; the three guestbook entries
are never translated; the 应为 typo stays.

---

## 2. Verdict

| | |
|---|---|
| Weighted score | **7.2 / 10** |
| Restyle the design system | **No.** |
| Rewrite any existing copy | **No** — locked by gate. |
| Add verbs | **Yes. This is the whole job.** |

---

## 3. Proposed build — five new panels, in priority order

Each is a new sector or page, built in the existing design language, each with a
complete static state, each bilingual through `zh.json` → `en.json`.

### P1 · 航班时刻表 / Departure Board — *new sector 03*
A split-flap FIDS cycling AXZ001–004 against real local time at KSFO and ZSPD.
Uses only data the site already has. Static state: a plain timetable table.
Fixes the "no timetable" gap and the dead-air problem after sector 02.
*Motion that responds to something real (the clock) rather than to scroll.*

### P2 · 航线网络图 / Interactive Network Map — *folds into sector 01*
One SVG world plate, great-circle legs for all four flights, click a leg →
its ATC strip and its altitude profile highlight. Binds the three figures that
currently sit unrelated. Static state: the existing charts and strips, unchanged.

### P3 · 签派台 / Dispatch Desk — *new page `/axz/dispatch/`*
Pick aircraft + route + payload → block time, fuel, cruise level, and a printable
**flight release** in the plate style, downloadable. Numbers derive from what the
site already publishes (110 km / 30 min / 5,500 ft; 280 km / 50 min / 9,500 m).
The C# recorder makes `.axzlog`; this makes the document that precedes it.

### P4 · 落地评分 / Landing Scorer — *mini-game, `/axz/dispatch/` or its own page*
Time the flare; get a vertical speed; **the result is written as a 备注 cell** —
red, serif, caret-opened, in the site's own deadpan-absurd register (a firm one
earns you 跑道震动器). Keyboard-first (space to flare), full non-game fallback that
states the V/S bands as a table. This is the panel's favourite.

### P5 · 资源与联动 / Resources & Liveries — *new sector*
The missing outbound layer: sim-community links, chart/METAR/SimBrief pointers,
the recorder, the route tool — and a real **B-1717 Minecraft联动** panel with the
livery, which is currently the site's most shareable asset and is invisible.

### P0 · Housekeeping (do first, ships with anything)
Delete `pages.css` 477–554; restore the masthead ship to its intended
height-driven box; re-run all five gates.

---

## 4. What shipped — 2026-08-15

All five, plus P0. Built, mirrored to the portfolio repo, **not committed**.

| | |
|---|---|
| Documents | 10 → **12** (`/axz/dispatch/` + `/axz/en/dispatch/`) |
| Home sectors | 5 → **7** (board at 03, resources at 06) |
| CSS | +`panels.css`, −79 dead lines from `pages.css` |
| JS | +`panels.js` |
| Fonts | re-subset for the new hanzi; 263 KB across 8 faces |
| Gates | 5/5 pass; contrast 25 → **29** pairings, axe 10 → **12** docs × 2 themes |

Three defects found and fixed along the way, two of them pre-existing:

1. **`pages.css` 477–554** — duplicate + stale block; the masthead ship was
   boxed at ratio 1.208 against its natural 1.158. Now exact.
2. **`/axz/fixtures/sample.axzlog` was never copied into the build.** The
   logbook's "载入示例文件" button pointed at a URL that 404s on any freshly
   built deploy. The functional gate had stayed green because it feeds the
   reader the *source* file through `setInputFiles` and never fetched the URL
   the button uses. Build now copies it; the gate now checks both paths.
3. **Selected + hovered network button** painted `--ink` text on an `--ink`
   fill — two same-weight selectors in the wrong order. axe cannot see hover
   states, so only a screenshot caught it.

## 5. Gate obligations for every item above

1. `check-axz-content` — 313 existing phrase runs still present.
2. `check-axz-contrast` — every new colour pairing **computed**, not estimated.
3. `check-axz-en` — new locked renderings added for any new fixed term.
4. `axe-axz` — new pages × 2 themes, WCAG 2.2 AA.
5. `verify-axz` — keyboard path for every new interactive element, and a
   verified static/no-JS equivalent for every animation and both games.
