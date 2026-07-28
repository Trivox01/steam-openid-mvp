# Game Details 2.0 — Achievement Experience

## Purpose

Game Details is the focused view of one game's achievement journey. It answers
three questions without inventing data: what is known about completion, which
achievements were recently unlocked, and which known rare opportunities remain.

The existing game route is retained. The page reads `GameService` and
`AchievementService`; synchronization continues through
`SteamAchievementSyncService` rather than invoking Tauri from React.

## Page structure

1. Game Hero with background, cover, platform, playtime, local game status,
   favorite state, achievement completion, and counts.
2. Optional Continue Your Journey recommendation from the Intelligence Engine.
3. Progress Overview with six compact metrics.
4. One optional Intelligence state banner.
4. Per-game achievement synchronization status and action.
5. Recent Unlocks when valid dates exist.
6. Rare Unlocks and Rare Opportunities when global rarity is known.
7. Achievement Toolbar and progressive Grid/List collection.

## Achievement states

- **Unlocked:** `unlockStateKnown=true` and `unlocked=true`. The colored icon is
  used. A date is shown only when it is present and valid.
- **Locked:** `unlockStateKnown=true` and `unlocked=false`. The locked Steam icon
  is preferred.
- **Unknown:** `unlockStateKnown=false`. It is explicitly labelled Unknown and
  is not counted as locked.
- **Hidden:** Steam-provided name and description are displayed when present.
  Missing fields use a neutral hidden-achievement UI message; no description is
  invented.

`unlocked` is intentionally independent of `unlockedAt`, because Steam may
report a valid unlock without a usable timestamp.

## Rarity

The shared threshold is `JOURNEY_THRESHOLDS.rareAchievementPercent` (10%).
An achievement is rare only when `globalUnlockPercent` is finite, greater than
zero, and at or below 10%. Missing rarity is displayed as Unknown and never
treated as zero.

Rare Unlocks contain known unlocked achievements. Rare Opportunities contain
known locked achievements. Unknown player states appear in neither group.

## Progress and unknown data

Completion is calculated only after the game has achievement synchronization
metadata and every achievement has a known player state. A partial response
shows Unknown rather than a misleading percentage. Rare counters use only known
global percentages. Last unlock uses only valid real timestamps.

## Toolbar

Search matches Steam display names and descriptions locally.
Ctrl/Cmd + F focuses and selects the local achievement search while this page is mounted.

Filters:

- All
- Unlocked
- Locked
- Rare
- Hidden
- Recently Unlocked

Sorting:

- Default stored repository order
- Name
- Unlock status
- Rarity, with unknown values last
- Unlock date, with invalid or missing dates last

Grid/List and Compact/Comfortable/Large are page-local preferences in v1.

## Intelligence

The page sends normalized game and achievement data to the existing Achievement
Intelligence Engine. React does not implement journey rules. At most one banner
is rendered, using one of `oneAchievementLeft`, `almostFinished`,
`rareOpportunity`, `recentlyCompleted`, or the engine's non-null next
achievement. Estimated time and personal progress are never fabricated.

## Synchronization states

- Never synced
- Success
- Partial
- Unsupported/no achievements
- Private player stats
- Failed

The button is disabled during a request. The existing service prevents
overlapping synchronization, and one data revision is published after the
operation. There is no startup, automatic, polling, or background sync.

## Performance

Filtering, sorting, summaries, rare groups, recent unlocks, and intelligence
input are memoized. Cards are memoized and images are lazy-loaded outside the
Hero. The main collection renders 120 items initially and adds another 120 per
user action, keeping 500–1000+ achievement libraries responsive without adding
a virtualization dependency.

## RTL and accessibility

Official game and achievement text uses `dir="auto"` and is not translated.
Layout uses logical CSS properties where direction matters. Controls are native
inputs, selects, and buttons with visible focus states and ARIA labels. Status
is communicated with text and icons rather than color alone. Motion is limited
to hover transforms and removed under `prefers-reduced-motion`.

## v1 limits

- Steam schema order is not stored as a dedicated database field; “Default”
  preserves the order returned by the current repository.
- Toolbar preferences are not persisted.
- No virtualization library is included.
- No personal achievement progress or estimated completion time is displayed.
- No Steam endpoints, database schema, or synchronization rules were changed by
  the Game Details 2.0 work.
