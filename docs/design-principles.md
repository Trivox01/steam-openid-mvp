# Achievement Nexus — Design Principles

Binding reference for every UI/UX change in Achievement Nexus. Read this before
designing or implementing any screen, and before opening or reviewing a UI PR.
It applies to human designers, developers, and AI agents equally.

Scope and precedence:

- This document defines the rules a change must satisfy.
- `docs/design/UI_UX_DESIGN_BIBLE.md` remains the detailed reference for existing
  screens, tokens, and component specifics. Where the two disagree, this
  document wins and the Bible should be corrected in the same PR.
- Product state: the desktop session compatibility phase is closed. Current work
  is product and feature development, so UI changes are no longer blocked by
  cutover work, but they are still held to the same review discipline.

---

## 1. Product design philosophy

- Achievement Nexus is a **Windows desktop application**, not a web page and not
  a marketing site. It is judged against desktop software users already trust:
  Steam, Explorer, Visual Studio Code.
- It is a **professional gaming product**. Content is the user's real library,
  achievements, tools, and progress. The interface serves that content and does
  not compete with it.
- Every screen must read as **authored by a person who understands the task**:
  deliberate hierarchy, purposeful spacing, realistic content.
- The product must not look **AI-generated, template-generated, or like a
  concept shot**. Concept-shot polish with no working behaviour behind it is a
  defect, not a style.
- **No generic templates.** A layout copied from a dashboard starter kit is
  rejected even if it looks clean.

## 2. Anti-AI-generated design rules

The following are not allowed. Each is a review blocker on its own.

| Not allowed | Why it is a defect here |
| --- | --- |
| Oversized cards with no functional reason | Wastes desktop space that belongs to content |
| Excessive glassmorphism | Reduces legibility over game artwork; not a Windows idiom |
| Generic purple/blue gradients | Carries no product meaning and dates the product instantly |
| Glow on every element | Destroys focus and state signalling |
| Excessive rounded corners | Reads as web template, breaks alignment with dense rows |
| Repetitive card grids | Turns different tasks into the same undifferentiated wall |
| Fake or placeholder metrics | Lies to the user and hides missing data paths |
| Decorative pills or badges with no function | Visual noise competing with real status |
| Oversized hero sections | Pushes real content below the fold on 1280-wide windows |
| Random decorative icons | Icons must identify actions or states, nothing else |
| Generic marketing copy inside product UI | Product UI instructs; it does not sell |
| Elements added only to fill empty space | Empty space is handled with a real empty state, not decoration |

If an element exists because the screen "looked empty", remove it.

## 3. Desktop density rules

Default to the densest form that still reads clearly.

Order of preference for presenting a set of items:

1. **Row** — one item per line, scannable, keyboard navigable.
2. **List** — grouped rows with a header.
3. **Table** — when items have three or more comparable attributes.
4. **Card** — only when a visual asset (game artwork, tool cover) is the primary
   identifier, or the item needs an inline preview that a row cannot carry.

Rules:

- Do not convert rows into cards for visual variety.
- Controls are compact: standard button height 32 px, dense row height 38–44 px,
  icon-only buttons 32×32 or 38×38 as already used in the product.
- Spacing is functional: 4 / 8 / 12 / 16 px steps. Larger gaps require a reason
  (separating unrelated task groups).
- A window at 1280×720 must show useful working content without scrolling past a
  decorative header.
- Alignment beats decoration: labels, values, and actions line up on shared
  vertical edges across a screen.

## 4. Frozen library constraints

These values are frozen. They may not be changed without an explicit product
decision recorded in the PR description.

```
--library-card-min: 208px
portrait ratio: 2:3
~6 columns @1920
5 columns @1440
4 columns @1280
Play/Install: icon-only, 38×38
```

A PR that changes card minimum width, aspect ratio, column counts at those
breakpoints, or the Play/Install control size must say so in its title and
include the reason and the decision that authorises it. Otherwise the change is
reverted, not negotiated in review.

## 5. Functional visual justification

For every new visual element, the author must be able to answer both questions
in the PR description:

1. **What information or function does it provide?**
2. **What does the user lose if it is removed?**

If either answer is unclear, vague, or aesthetic only, the element is not added.

This applies to containers, dividers, badges, icons, headers, gradients,
shadows, animations, and empty-space fillers — not only to interactive controls.

## 6. Real data only

- No fake statistics, sample charts, or invented counts in production UI.
- No placeholder product metrics shipped "until the real data lands". Ship the
  feature without the metric instead.
- Every data surface defines four real states, and each is designed, not
  improvised:
  - **Loading** — a bounded indicator; skeletons only where layout is known.
  - **Empty** — explains what will appear here and the next action to take.
  - **Error** — states what failed, what the user can do, and offers retry.
  - **Offline** — distinguishes "no connection" from "no data", and shows what
    remains usable from the local cache.
- Numbers shown must come from a real source (backend or local cache) and must
  be consistent across screens showing the same value.

## 7. Effects and color

- Effects are restrained. Borders and shadows exist to express hierarchy,
  elevation of transient surfaces (menus, dialogs, popovers), and interaction
  state. Nothing else.
- There is **no decorative glow system**. Glow is not used as branding.
- Color carries function: installed / not installed, progress, success, warning,
  error, offline, selected. A color used decoratively weakens the same color
  when it must signal state.
- Never rely on color alone: pair it with an icon, label, or position.
- Dark and light themes are both first-class. Contrast is verified in both, over
  real game artwork, not over flat mock backgrounds.

## 8. Typography and microcopy

- Use system typography: **Segoe UI Variable** on Windows, with the standard
  system fallback stack.
- Keep a **limited type scale**. Prefer weight and color for emphasis over new
  sizes. Introducing a new size requires a reason.
- Use **tabular numbers** for aligned numeric columns: achievement counts,
  percentages, playtime, dates in tables.
- Microcopy is natural and specific. Prefer a verb the user recognises
  ("Sync library", "Retry") over abstract nouns. No marketing tone.
- **Arabic and English are both required.** Arabic copy is written
  intentionally by someone reading it as Arabic, never a literal machine
  translation of the English string.
- **Full RTL support** is mandatory: mirrored layout and navigation, correct
  icon direction for directional icons, correct alignment of numbers and mixed
  Arabic/Latin strings. Every UI PR is checked in RTL before review.

## 9. Interaction rules

- Feedback is subtle and immediate: pressed, hovered, focused, selected,
  disabled, busy.
- **Focus must always be visible** and reachable by keyboard. Keyboard access is
  not optional on desktop.
- `hover`, `focus`, `selected`, and `disabled` are visually distinct from each
  other, in both themes.
- **No decorative motion.** Animation only communicates a relationship
  (expansion, navigation direction, item removal) and stays short.
- **Never use `setTimeout`, `debounce`, or a page/window reload to hide a state,
  race, or reliability problem.** Fix the state machine. Use bounded retries,
  single-flight requests, stale-write protection, and explicit states instead.
  This rule is shared with the reliability rules of the codebase and is not a
  style preference.
- Destructive actions require an explicit confirmation that names the object,
  and are never the default focus target.

## 10. Contextual consistency

- Reuse components: buttons, rows, panels, dialogs, empty states, toolbars.
- Reuse does not mean repetition. Two screens with different tasks are allowed
  and expected to have different layouts.
- Consistency applies to **behaviour, spacing rhythm, and control sizing**, not
  to duplicating a page skeleton.
- Purposeful asymmetry is allowed when the task has one dominant area and one
  secondary area. A symmetric split that ignores task weight is worse.

## 11. Feature UI workflow

Follow this order before writing UI code:

1. **Study the current product** — open the relevant screens, read existing
   components and tokens, and note what already exists. Do not redesign what is
   already solved.
2. **Identify the user task** — one sentence: who is doing what, and what
   decision or outcome ends the task.
3. **Define hierarchy** — what must be readable first, second, and on demand.
4. **Define real states** — loading, empty, error, offline, plus permission and
   sync states where relevant, with the real data source for each.
5. **Design** — at the target density, at 1280 and 1920 widths, dark and light,
   LTR and RTL.
6. **Implement** — reuse existing components and tokens; add a new component
   only when no existing one fits.
7. **Local visual validation** — run the desktop app and verify the states,
   both themes, both directions, keyboard navigation, and the frozen library
   constraints. Screenshots in the PR when layout changed.

## 12. UI PR checklist

Copy into the PR description and answer every line. "N/A" requires a reason.

- [ ] Does it look human-designed rather than generated or templated?
- [ ] Any unnecessary card, container, or wrapper that should be a row?
- [ ] Any decorative effect (glow, gradient, glass, shadow, motion) without a
      stated purpose?
- [ ] Is all displayed data real, with no fake or placeholder metrics?
- [ ] Are loading, empty, error, and offline states implemented and reviewed?
- [ ] Checked in RTL with Arabic copy that reads naturally?
- [ ] Desktop density preserved (rows/lists/tables first, compact controls,
      usable at 1280 width)?
- [ ] Frozen library constraints preserved (208px min, 2:3, 6/5/4 columns,
      38×38 Play/Install)?
- [ ] Is every new visual element justified by information or function, with
      the loss-if-removed answered?
- [ ] Both themes checked, keyboard navigation and visible focus verified?
- [ ] No `setTimeout`, `debounce`, or reload used to mask a state or
      reliability problem?

A PR that cannot pass this checklist is not ready for review, regardless of how
finished it looks.
