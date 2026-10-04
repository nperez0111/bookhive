# Styling Notes

Background for `src/routes/main.tsx`'s `jsxRenderer` shell and `src/index.css`. Read this before
touching `<main>`'s classes or basecoat button variants.

## The app shell scroller — never put `overflow-*-auto` on `<main>`

Every app page is wrapped in
`<main class="flex-1 overflow-x-clip [overflow-clip-margin:5rem] flex justify-center px-4 py-4 lg:px-6 lg:py-6">`
→ `<div class="mx-auto w-full min-w-0 max-w-5xl">`. Four constraints, each load-bearing:

- **`overflow-x-clip`, not `auto`.** `overflow-x: auto` with `overflow-y: visible` forces
  `overflow-y` to compute to `auto` too, making `<main>` a scroll container on both axes. Its
  height then equals its content height, leaving a few px of residual scrollable overflow that the
  mouse wheel latches onto and never chains out of — pages stopped scrolling ~26px in. A clip
  container is not a scroll container.
- **Not `overflow-visible` either.** `BookTooltip` is always rendered (at `opacity-0`), so its
  `w-48` box permanently contributes horizontal overflow; removing the clip produces a
  document-level h-scrollbar on grid pages at 768–1280px. `overflow-clip-margin` widens the clip
  edge instead so tooltips can overhang the column (`src/pages/components/book.tsx` does the same
  for the profile `BookList` panel).
- **`w-full min-w-0` on the inner column, and keep `flex justify-center`.** Without `w-full` the
  column sizes to max-content, so content-light pages render narrower. `min-w-0` keeps the flex
  floor deterministic. `justify-center` is the only thing centring the column at `lg`+, and
  `<main>`'s flex `align-items: stretch` is what makes `min-h-full` resolve for the
  `-mx-4 … min-h-full` full-bleed pattern on `explore.tsx`/`genres.tsx`/`authorDirectory.tsx`.
- **The gutter is `px-4 lg:px-6` PADDING on `<main>`, never a margin on the column.** It used to be
  `m-4 lg:m-6` on the column next to `mx-auto` — but Tailwind v4 emits `margin-inline` after
  `margin`, so `mx-auto` won and the horizontal margin computed to **0 below `lg`**. Every page's
  content sat flush against both screen edges on mobile, and the `-mx-4 … px-4` full-bleed sections
  overhung the viewport by 16px per side with their right edge clipped off. Padding can't be
  overridden by `mx-auto`, still lets the column centre itself, and keeps the negative-margin
  full-bleed trick cancelling exactly.

Wide content (the library/import tables) already clips itself, so `<main>` doesn't need to.

## basecoat's button variants are standalone classes, not modifiers

The app enforces 40px minimum targets on `.btn` (including `.btn.btn-sm`) and `.input`.
The compact button variant keeps its smaller typography and padding, not a smaller hit area.
Search triggers, share-menu items, settings selects and the e-reader setup disclosure follow
the same minimum and use the shared focus recipe. Do not enlarge checkbox/radio glyphs;
their surrounding labels provide the targets.

E-reader credential rows must let their `code` values shrink and wrap (`min-w-0`, `break-all`)
while keeping Copy actions visible. A long public origin pushed those buttons beyond the phone
viewport; the shell's intentional clipping hid this without document-level horizontal overflow.
Check control bounds as well as `scrollWidth` when auditing narrow screens. Book-detail controls
and their no-JS fallback keep matching 40px heights and shared focus rings.

`.btn` _is_ the primary variant (`bg-primary text-primary-foreground`); `.btn-ghost` only declares
a `:hover` state and `.btn-outline` overrides the background but not the text colour. The app
writes `btn btn-ghost` in ~40 places, which rendered every one as a filled primary button, and
`btn btn-outline` rendered as invisible text. `src/index.css` patches both via the
higher-specificity `.btn.btn-ghost` / `.btn.btn-outline` selectors — keep using the compound form,
don't "fix" call sites individually.

The sidebar's `a[aria-current="page"]` rules use a `bg-primary/15 text-primary` tinted pill for the
current page, not a solid fill — they used to be byte-identical to `.btn-primary`, so in the mobile
drawer the active nav item and the "Buzz in" sign-in button rendered as two indistinguishable
filled amber pills. **Solid `bg-primary` means "call to action"; tinted means "you are here."**
Keep selected/current states tinted and leave the solid fill to real actions.

## Responsive audit coverage (October 2026)

The signed-in preview was checked at 390px, 744px, 1133px and 1920px. Settings, shelf creation,
import, feed, Explore and the genre directory passed control-bound and minimum-height checks
at all four widths. E-reader setup was rechecked on phone after fixing clipped Copy actions;
its wider layouts were already within bounds. Populated My Books was checked on phone and
desktop, including its reading filter. Account menus, the mobile drawer and search palette
were opened without changing account data.

These are DOM/layout checks, not screenshot approval: screenshot capture was unavailable.
The fresh development database also left feed, shelves and discovery directories empty, so
populated versions of those views still need review. Native iPad date/select rendering and
an image-based light/dark contrast pass remain manual checks.

## The cover fade is decode-triggered, not insertion-triggered

`.book-cover` only animates once it also has `.is-loaded`, added by a document-level
**capture-phase** `load` listener in `navbar.tsx` (`load` doesn't bubble, so capture is what makes
one listener cover every cover on the page, including lazy ones and covers client islands render
after hydration). Animating on insertion meant the 200ms elapsed before a lazy cover had
downloaded, so the fade only ever played for already-cached covers. Don't add an `opacity: 0`
default to `.book-cover` to "smooth" this — with JS off nothing adds `.is-loaded` and every cover
would be permanently invisible.

## Library menus stay inside the content column

`AnchoredMenu` keeps its checkbox open state and form-reset dismissal. Its absolute panels
are measured on checkbox changes and content-column resize, then clamped between the main
column's gutters and the viewport. Clamp the parent menu before its nested confirmation:
confirmations are wider, and their containing block moves with the parent. Right-aligning every
panel blindly put the first card's delete action under the desktop sidebar or off-screen on
mobile. Keep panel widths capped to the available column width as well. This is placement-only
JavaScript; do not replace the checkbox/form behavior with Popover or CSS anchor positioning.

## View transition names identify one rendered element

The genre directory repeats featured genres in its full list. Giving both labels the same
`view-transition-name` made Chromium reject the destination snapshot with “Transition was skipped”.
Featured labels own their names; their duplicate directory rows stay unnamed. All genre labels
use `lib/viewTransitionName.ts` to encode arbitrary genre text as a stable CSS identifier (raw
spaces and punctuation invalidated the old custom-property value).

Books can repeat across lists or uploaded editions too. `pages/utils/viewTransitions.ts` runs inline
in Layout's head so its `pagereveal` listener is registered before the destination snapshot. On
`pageswap` and `pagereveal`, it keeps the first rendered book/genre occurrence per computed name
and disables only duplicates. Each pass first clears its previous overrides, so filtering,
hydration and back/forward restoration can change which occurrence owns the name. This fixes
name collisions; it does not catch or suppress transition rejections.

The cross-document `@view-transition { navigation: auto; }` opt-in lives in Layout's early inline
head style, not the asynchronously imported development CSS. Otherwise Vite inserts that CSS
after `pagereveal`: the source opts in while the destination has not yet opted in, causing a
separate skipped-transition AbortError even when all element names are unique. Keep the opt-in
available before module scripts execute in development and production.

## Dense book-card actions support keyboard and touch

`BookCard`'s dense action overlay is a sibling of its cover link inside the cover frame.
Do not put shelf-removal forms/buttons inside the anchor: nested interactive controls produce
invalid markup and ambiguous navigation/submission. The frame still moves as one on hover.
The overlay reveals on `group-focus-within` as well as hover and stays visible on devices with
`hover: none`. Its scrim ignores pointer events while its contents accept them, so the unoccupied
cover remains a link. Keyboard users previously focused an entirely transparent Remove button.

## Import-label text must not contain its script

The CSV drop-zone label wraps the visible instructions and file input; its inline `Script` is a
sibling. Script source inside the label was included in the file chooser's accessible name by
the browser accessibility tree. Keep behavior code outside labels, even though it is visually hidden.

The focusable drop-zone label implements Enter/Space activation explicitly (labels do not provide
button keyboard behavior). Drag/drop prevents browser file navigation, assigns the dropped files
to the input, and dispatches its normal change event. Both entry paths require one `.csv` file,
report rejected selections inline, and share the existing upload/SSE path. CSV content/header
validation remains on the server; file MIME types vary by OS and are not a reliable CSV gate.

The SSR import-service radio uses `checked` for its initial Goodreads selection. Hono's server
renderer emits `defaultChecked` literally, which leaves every radio unselected and makes the
instruction/endpoint fallback choose Hardcover. Reserve DOM-library default props for hydrated
components; server-rendered inputs need actual HTML boolean attributes.

## Library page inputs follow saved progress

`LibraryTable` page edits send progress alone so the shared reading lifecycle can infer Finished
at the last page. Sending the row's old status explicitly overrides that inference. The input
follows replacement progress objects from canonical responses and optimistic rollback, even when
the canonical page number is unchanged. Empty, fractional, below-one, or beyond-total edits restore
the saved page on blur. The book-progress lexicon requires currentPage/currentChapter >= 1;
zero percent is supported, but page zero is not. Exact page counts accompany rounded percentages so
657/658 cannot become Finished merely because its displayed percentage rounds to 100.

## Navigation and account disclosure

The sidebar keeps six flat destinations: Home, My Books, Shelves, Discover, Activity,
and Ebooks. Public profile, Reading Stats, Import books, Settings and Sign out live in
Navbar's native `details` account disclosure, visible on desktop and mobile. Native disclosure
keeps account links reachable without hydration or JavaScript; links use ordinary Tab navigation,
with Escape returning focus to the summary and outside click/focus dismissing the panel.
The narrow mobile header shows the logo without the wordmark to leave room for search and
the account trigger. The theme toggle stays in the mobile drawer.

My Books has no subnavigation or repeated shelf/stats/ebook jump-links; its header retains
Import books. It alone uses a 1600px content-column cap (other pages remain `max-w-5xl`),
with the same shell padding and overflow clipping. The cover grid defaults at 1200px and below and grows
to seven columns on wide displays. Search, reading-status filters and sort apply to both views.
Above 1200px the workspace defaults to the table. Until a view is chosen manually, the default
follows viewport changes; an explicit choice stays selected for the current page.
Table mode preserves inline edits; at 1200px and below it uses the existing editable stacked cards.
The view toggle uses grid/table icons with titles and accessible names, 40px square targets
(each with its own border, without a padded outer frame, matching the search field's height),
and a tinted selected segment, not competing action buttons. Sorting stays
in the toolbar above either view. Dense workspace cards reserve two title lines and one author
line (including missing authors), so their 40px status/rating controls share row baselines.
`TrackedBooks` server-renders the actual `LibraryTable` component, with a disabled fieldset
until the island mounts. Its `responsive` initial view paints the grid through 1200px and
table above 1200px using CSS, without consulting a server-side viewport. JavaScript enables
the same controls rather than replacing a read-only layout with a different toolbar or table.
Book-title/cover links remain navigable even inside a disabled fieldset. Without scripts,
`noscript` hides the JS-only toolbar, grid controls and delete column and explains that edits
live on the linked book pages. Failed island loads still leave real books and working links;
do not hide the workspace with a JS-enabled class or replace it with a loading skeleton.
Select options explicitly serialize `selected` so SSR shows the actual status and rating
(a select's `value` attribute alone does not select an HTML option).
Server and client share `pages/utils/trackedBookOrder.ts` for the initial reading-first order.
Development `Layout` links `/src/index.css?direct` as a blocking stylesheet as well as the
client entry's HMR CSS import: JS-only CSS arrival previously allowed an unstyled first paint
and left no-JS previews unstyled. Production still uses the manifest/inline CSS path.
Inline JSX stylesheet strings must use `raw` for trusted, static CSS; HTML-escaped `>` in a
child selector silently makes the selector invalid.
The fixed sidebar is 208px wide from 768–1199px (including iPad mini landscape), with a
matching content offset. At 1200px and above it stays 280px; below 768px it remains a drawer.

Above 1200px, search, result count, status filter, sorting and view controls share a single
toolbar row; the search field shrinks to make room for the fixed-size controls. On smaller
screens, search and the square view toggle share a row. Table status, rating, page and date
fields retain the same 40px minimum height, and missing covers use `FallbackCover`.
Reading-status filtering uses one native
select alongside sorting at every viewport size, with book counts included in each option.
The page title and Import books action share the header row, with supporting copy below.
Public profiles use read-only cover tabs even for their owner. Home retains its stats link.
Home uses one consistent section treatment: a heading and count, a short supporting line,
and author-labelled covers with reserved text slots. Empty shelves use the shared `.empty`
treatment with at most one contextual action. The header's Find a book action opens the search
palette (with a normal `/search` fallback); the compact stats summary uses a semantic definition list.
The optional PDS information link lives in the sidebar footer, outside primary navigation,
labelled BookHive.social with the shared Users community icon.

The editable LibraryTable mobile cards stack book identity above controls. A non-shrinking
control column beside the title previously covered the title/cover on narrow viewports; dates
stack below `sm` so native date inputs fit. The account panel does not use basecoat's `.dropdown-menu` class: that class styles an inline-flex trigger wrapper, not the panel,
and lays the account links out horizontally beyond the viewport.

The account panel uses a stronger layered shadow, with deeper dark-mode shadows and a faint
light edge, to separate it from the similarly colored page background.
