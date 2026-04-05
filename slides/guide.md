# Slidev Customization Guide

Reference for tweaking `slides.md` — covers fonts, layouts, backgrounds, styles, transitions, and more.

---

## 1. Fonts

Fonts are configured in the global frontmatter (the very first `---` block).

```yaml
---
fonts:
  sans: Inter # body text and headings
  serif: Lora # available via `font-serif` class
  mono: JetBrains Mono # code blocks
  weights: "300,400,600,700"
  italic: true
---
```

- Fonts are **auto-imported from Google Fonts** by default — just use any font name available there.
- `sans` is applied globally. Your current theme (`seriph`) uses a serif-ish default; overriding `sans` is the fastest way to change the entire deck's feel.
- To use a **locally installed** font (not from Google), add it to `fonts.local`:

```yaml
fonts:
  sans: "Helvetica Neue"
  local: Helvetica Neue # tells Slidev not to try importing this from CDN
```

- To disable CDN imports entirely: `provider: none`

**Quick wins for your deck:**

- Swap to `Inter` or `DM Sans` for a cleaner, modern look.
- Use `Playfair Display` as `serif` for pull quotes — your "day after" test slide quote would benefit from `<span class="font-serif italic">`.

---

## 2. Slide-Level Frontmatter

Every slide can have its own frontmatter block placed directly before the `---` separator:

```yaml
---
layout: cover
background: /images/hero.jpg
class: text-white
transition: fade
zoom: 0.9
---
```

**Full list of per-slide options:**

| Option              | What it does                                          |
| ------------------- | ----------------------------------------------------- |
| `layout`            | Which layout component to use (see §3)                |
| `background`        | Background image URL or CSS color/gradient            |
| `class`             | CSS classes added to the slide root element           |
| `transition`        | Transition animation into this slide                  |
| `zoom`              | Scale the slide canvas (e.g. `0.8` to shrink content) |
| `clicks`            | Override how many clicks before advancing             |
| `hide` / `disabled` | Hide the slide entirely                               |
| `hideInToc`         | Exclude from auto-generated table of contents         |
| `title`             | Override the slide's title in navigation              |
| `routeAlias`        | Give this slide a URL-friendly alias                  |

---

## 3. Layouts

Your current deck uses `layout: two-cols`, `layout: center`, and the default. Here's the full built-in set:

| Layout            | Best for             | Notes                                                   |
| ----------------- | -------------------- | ------------------------------------------------------- |
| `default`         | Most slides          | What you get with no `layout` set                       |
| `cover`           | Title slide          | Styled for big hero presentation                        |
| `center`          | Single statements    | Content centered vertically and horizontally            |
| `section`         | Chapter dividers     | Bold section heading                                    |
| `statement`       | Key assertions       | Large single line — great for "A PDS Is Not a Database" |
| `fact`            | Stats / numbers      | Prominent data display                                  |
| `quote`           | Pull quotes          | Styled quotation — good for the "Day After" blockquote  |
| `image-left`      | Image + text         | `image: /path.jpg` in frontmatter                       |
| `image-right`     | Image + text         | Same as above, flipped                                  |
| `image`           | Full-bleed photo     | `image:` + `backgroundSize: cover`                      |
| `two-cols`        | Side-by-side         | Use `::right::` to split content                        |
| `two-cols-header` | Header + two cols    | Use `::left::` and `::right::` plus a top section       |
| `iframe-left`     | Live web page + text | `url:` in frontmatter                                   |
| `full`            | No padding           | Content fills entire canvas                             |
| `none`            | Bare canvas          | No theme styles at all                                  |
| `end`             | Final slide          | Themed closing page                                     |

**Example — upgrading your quote slide:**

```yaml
---
layout: quote
---

> If BookHive disappeared tomorrow, is the data in your PDS still meaningful?
```

**Two-cols with header** (useful for the catalog diagram slide):

```yaml
---
layout: two-cols-header
---

# The Catalog Account

::left::
Left column content

::right::
Right column content
```

---

## 4. Backgrounds

Set backgrounds per slide via frontmatter:

```yaml
---
background: '#1a1a2e'              # hex color
background: 'rgb(30, 30, 46)'     # rgb
background: 'linear-gradient(135deg, #1e3a5f 0%, #0d1b2a 100%)'  # gradient
background: /images/cover-bg.jpg  # image from public/
background: https://...           # remote image (use absolute paths for builds)
---
```

**Tip:** Put images in `public/images/` and reference as `/images/filename.jpg`. Relative paths break after build.

For your title slide specifically, a dark gradient background with `class: text-white` would make `@bookhive.buzz` pop:

```yaml
---
layout: cover
background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)"
class: text-white
---
```

---

## 5. Global Styles

Create `styles/index.css` in your project root (next to `slides.md`) for deck-wide CSS:

```css
/* styles/index.css */

/* Custom heading styles */
.slidev-layout h1 {
  font-size: 2.5rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

/* Style the author byline on your title slide */
.slidev-layout .byline {
  font-size: 1.1rem;
  opacity: 0.8;
}

/* Tighter code blocks */
.slidev-layout pre {
  font-size: 0.85em;
}
```

**Important:** Wrap selectors in `.slidev-layout` to avoid leaking styles into the presenter UI.

---

## 6. Per-Slide Scoped Styles

Add a `<style>` block directly in any slide's Markdown to scope styles to just that slide:

```markdown
---
layout: two-cols
---

# What We Actually Store

<style>
pre {
  font-size: 0.7em !important;
  line-height: 1.4;
}
.col-right {
  padding-left: 1rem;
}
</style>
```

This uses Vue scoped CSS under the hood — useful for nudging font sizes or spacing on specific dense slides.

---

## 7. Transitions

Set a global default in your headmatter (you already have `transition: slide-left`), or override per slide:

```yaml
---
transition: slide-left # global default
---
```

Per-slide override:

```yaml
---
transition: fade
---
```

**Built-in transitions:**

| Name              | Effect                                |
| ----------------- | ------------------------------------- |
| `fade`            | Cross-fade                            |
| `fade-out`        | Fade out then in                      |
| `slide-left`      | Slide in from right (default forward) |
| `slide-right`     | Slide in from left                    |
| `slide-up`        | Slide in from bottom                  |
| `slide-down`      | Slide in from top                     |
| `view-transition` | Browser View Transition API           |

**Asymmetric forward/back transitions:**

```yaml
---
transition: slide-left | slide-right
---
```

---

## 8. The `seriph` Theme

Your deck uses `theme: seriph` — the official Slidev default. It's a clean, serif-accented academic theme.

**Theme-level config** via `themeConfig` in headmatter:

```yaml
---
theme: seriph
themeConfig:
  primary: "#5d8392" # accent color used for highlights, links, etc.
---
```

**To deeply customize the theme**, eject it into your project:

```bash
npx slidev theme eject
```

This copies all theme files into `./theme/` and updates your frontmatter to `theme: ./theme`. You can then edit layouts, components, and CSS directly. Good option if you want to tweak the cover layout or heading styles fundamentally.

**Alternative themes worth trying:**

- `default` — minimal, no serif flourishes
- `apple-basic` — clean Apple-keynote inspired
- `bricks` — bold, geometric
- `penguin` — modern, colorful

Install any theme with `npm install slidev-theme-<name>`, then set `theme: <name>`.

---

## 9. Slide Canvas Size

Default is `16/9` at `980px` canvas width. Override in headmatter:

```yaml
---
aspectRatio: 16/9 # or '4/3', '1/1'
canvasWidth: 1280 # wider canvas = more breathing room for content
---
```

Increasing `canvasWidth` is useful if your code blocks feel cramped — wider canvas means more characters per line without font shrinking.

---

## 10. Quick Wins for Your Specific Deck

Based on `slides.md` as it stands:

**Title slide** — add a background gradient and lean into the cover layout:

```yaml
---
layout: cover
background: "linear-gradient(160deg, #0f172a 0%, #1e3a5f 100%)"
class: text-white
---
```

**"A PDS Is Not a Database" slide** — swap to `statement` layout for maximum impact:

```yaml
---
layout: statement
---
# A PDS Is Not a Database
```

**"Day After Test" blockquote** — use `quote` layout:

```yaml
---
layout: quote
---

> If BookHive disappeared tomorrow, is the data in your PDS still meaningful?
```

**Core principle slide** — already uses `layout: center`, which is correct. Add a class for sizing:

```yaml
---
layout: center
class: text-center text-2xl
---
```

**Code example slide** — the two-cols layout is right. If the JSON feels cramped, try `zoom: 0.85` in the frontmatter to shrink just that slide.

**Fonts** — your current setup uses seriph defaults. For a tech/protocol talk, consider:

```yaml
fonts:
  sans: Inter
  mono: JetBrains Mono
  weights: "400,600,700"
```
