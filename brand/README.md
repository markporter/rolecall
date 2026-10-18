# rolecall — brand

Two final marks, both tracked here. Everything else (concepts, drafts, screenshots)
is iteration history, kept locally only — see [History](#history).

## Final assets

| Asset | File | Use |
| --- | --- | --- |
| **Icon** — letter R whose bowl counter is a bugle-bell horn mouth ("calling the roles") | `concepts/03-role-r.svg` (**v5**) | Favicon, home hero, standalone/app-icon contexts |
| **Wordmark** — the R fused with the rest of the name (`<LOGO>oleCall`) | `wordmark/wordmark-e.svg` (**E, round-2 reflow**) | Docs navbar lockup (icon-only R stays correct at favicon size) |

Both are `currentColor` on a `0 0 64`-height viewBox, monochrome, shapes/strokes
only (no fonts, no `<text>`), min stroke-width 5.

### Where they are applied (baked copies, tracked separately)

- `docs/content/public/logo.svg` + `docs/content/public/favicon.svg` — the **icon**,
  fills baked `#4C6EF5` (not `currentColor`; `<img>`/favicon rendering resolves
  `currentColor` to black).
- `docs/content/public/wordmark-light.svg` (`#4C6EF5`) +
  `docs/content/public/wordmark-dark.svg` (`#748FFC`) — the **wordmark** pair wired
  into `docs/.vitepress/config.ts` (`logo: { light, dark }`). The navbar text title
  beside the logo is CSS-hidden only, so the browser tab `<title>` stays "RoleCall".
- `docs/.vitepress/theme/custom.css` — indigo `--vp-c-brand-*` scale (light + dark)
  and brass `--rc-accent` for hero flair.

### Colors

- **Indigo `#4C6EF5`** — the brand color (icon, links, primary).
  Dark-mode link lighter: `#748FFC`.
- **Brass `#D9822B`** — the bugle-bell accent. Accent only, never a second brand color.

## Rules (executable)

The mark's letterform rules are asserted by `wordmark/verify-e.mjs` (run
`node brand/wordmark/verify-e.mjs`; exits non-zero on any violation):

- The **horn counter is reserved for the `R`**; every other counter is round.
- Rounds (o/e/C/a) get **+1u overshoot** top and bottom. x-height 32 = 0.667 of cap 48.
- The R's paths are **frozen** (translate-only), including the v5 seam fix.
- `e` and `C` share one **angled-cut terminal** language; `e` walls ≥7u with
  contrast ≤1.2 (monoline family match); `e` eye ≥6u **and ≤55%** of the `o` counter.
- All tracking is measured **ink-to-ink from drawn path extremes** (never bbox).
- C→a is deliberately tighter than e→C (4.7u vs 6.2u) to offset the C mouth's
  optical air — a numerically balanced pair reads wider on the open-mouthed side.

## Icon revision history (v1 → v5)

- **v1** — timid arc counter, stray wedge notch, over-heavy stem; horn didn't read <128px.
- **v2** — slimmer stem, exaggerated bell counter, notch gone; new hairline wall defect.
- **v3** — thicker horn throat, bowl to x=53, leg reseated flush; hairline fixed.
- **v4** — horn mouth pulled left so it no longer crowds the bowl's right edge.
- **v5** (current) — structural fix: the leg's top edge moved `y34→y33` so it
  **overlaps into the bowl's fill** instead of abutting it along a shared boundary
  line (which antialiased into a hairline seam). Silhouette shift <1u; verified at
  16x zoom, seam gone, silhouette identical.

## Wordmark decision record (why E)

- Round 1 (A/B/C): A won on spacing rhythm, B on raw letterforms, C on aperture
  openness; none shipped.
- **D** (merge of the three) was adopted, then **rejected by the user**: (1) its `e`
  read as a serif letter — the only modulated letter in a 9u-monoline word (4u
  top/bottom walls vs 7.5u sides, 1.9:1 contrast); (2) its `C` was skinny with a
  phantom C→a gap — tracking had measured the C's *undrawn* bounding edge (x185) as
  ink while the mouth cuts drawn ink at the arm tips (x170), so the real gap was
  19.5u and the lockup read "RoleC all".
- **E** fixed both: monoline `e` (walls 7–8u, contrast ≤1.2, bar 6u) and a widened
  `C` (parametric-radial ±45° cuts → ink 37.6u, aspect 0.75). Round-1 E shipped
  numerically balanced 8.2/8.2 gaps and the user **still read C→a as too wide**
  (open-mouth optical air) — the round-2 reflow tightened **C→a to 4.7u** with e→C
  at 6.2u (a +2u shift of o/l/e, −3.5u shift of a/l/l; constructions frozen;
  viewBox 252). **User-approved.**
- Rules retired along the way: the "eye ≥60% of the o counter" rule (mathematically
  incompatible with monoline walls on a 34u round — it is what shredded D's `e`) and
  the "vertical-only terminal cuts" rule (vertical cuts cannot satisfy mouth ≥22u and
  gaps ≤11u at this lockup width).

## History

The full iteration archive — concepts 01/02/04/05, icon drafts v1–v3, wordmark
variants A–D, both preview pages, `verify-d.mjs`, and every screenshot render — is
preserved **locally only** at `.local/brand-history/` (gitignored, not in the
repository). The concept rationale, if you want it later: 01 coil-call (most literal
"muster call"), 02 checkcast (safe/mainstream fallback), 04 present-signal (Morse
"R" — hosts answering present), 05 bell-ring (head-on horn — strongest geometry but
risks a donut read); 03-role-r won because it is the only concept that survives
favicon size, and it hides the pun inside the letter.
