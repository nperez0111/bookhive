# Slidev Customization Guide for `slides.md`

Reference for tweaking the ATmosphereConf presentation. Slidev docs: https://sli.dev

---

## Table of Contents

1. [Global Frontmatter (Headmatter)](#1-global-frontmatter)
2. [Per-Slide Frontmatter](#2-per-slide-frontmatter)
3. [Fonts](#3-fonts)
4. [Layouts](#4-layouts)
5. [Backgrounds](#5-backgrounds)
6. [Styling & CSS](#6-styling--css)
7. [Transitions & Animations](#7-transitions--animations)
8. [Components](#8-components)
9. [Directory Structure](#9-directory-structure)
10. [Display & Export Options](#10-display--export-options)

---

## 1. Global Frontmatter

The YAML block at the very top of `slides.md` configures the entire deck. Current config:

```yaml
---
theme: seriph
title: "Store the Maximally Useful Data"
transition: slide-left
duration: 15min
drawings:
  persist: false
---
```

### Key global options

| Option          | Description                                      | Example                     |
| --------------- | ------------------------------------------------ | --------------------------- |
| `theme`         | Theme name or npm package                        | `seriph`, `apple-basic`     |
| `title`         | Presentation title (used in meta/exports)        | `"My Talk"`                 |
| `transition`    | Default slide transition                         | `slide-left`, `fade`        |
| `colorSchema`   | Force light/dark mode                            | `'dark'`, `'light'`, `'auto'` |
| `aspectRatio`   | Slide aspect ratio                               | `'16/9'` (default), `'4/3'` |
| `canvasWidth`   | Canvas width in pixels                           | `980` (default)             |
| `lineNumbers`   | Show line numbers in code blocks                 | `true`                      |
| `selectable`    | Allow text selection                             | `true`                      |
| `download`      | Enable PDF download button in SPA build          | `true`                      |
| `record`        | Enable slide recording                           | `true`                      |
| `drawings`      | Drawing/annotation config                        | `{ persist: false }`        |
| `htmlAttrs`     | Attributes added to `<html>` tag                 | `{ lang: 'en' }`           |
| `fonts`         | Font configuration (see [Fonts](#3-fonts))       | `{ sans: 'Inter' }`        |
| `themeConfig`   | Theme-specific variables (injected as CSS vars)  | `{ primary: '#5d8aa8' }`   |

---

## 2. Per-Slide Frontmatter

Each slide (separated by `---`) can have its own YAML frontmatter:

```markdown
---
layout: two-cols
background: /my-image.jpg
class: text-white
transition: fade
clicks: 5
---

# Slide content here
```

### Key per-slide options

| Option       | Description                                  |
| ------------ | -------------------------------------------- |
| `layout`     | Layout for this slide (see [Layouts](#4-layouts)) |
| `background` | Background image URL or path                 |
| `class`      | CSS/UnoCSS classes applied to the slide      |
| `transition` | Override transition for this slide            |
| `clicks`     | Set total click count for animations          |
| `disabled`   | Disable/skip this slide                       |
| `hide`       | Hide slide from presentation                  |
| `zoom`       | Custom zoom scale                             |
| `preload`    | Pre-mount slide before entering               |

---

## 3. Fonts

Fonts are auto-imported from Google Fonts by default.

### Basic configuration

```yaml
---
fonts:
  sans: Inter
  serif: Playfair Display
  mono: Fira Code
---
```

### Font weights and italics

```yaml
---
fonts:
  sans: Inter
  weights: '200,400,600,700'
  italic: true
---
```

Default weights imported: `200`, `400`, `600`.

### Using local fonts (skip CDN)

```yaml
---
fonts:
  sans: 'Helvetica Neue, Inter'
  local: Helvetica Neue
---
```

### Disable fallback fonts

By default Slidev appends system font fallbacks. To disable:

```yaml
---
fonts:
  mono: 'Fira Code, monospace'
  fallbacks: false
---
```

### Font providers

| Provider    | Description                    |
| ----------- | ------------------------------ |
| `google`    | Google Fonts CDN (default)     |
| `coollabs`  | Privacy-friendly alternative   |
| `none`      | No auto-import (local only)    |

```yaml
---
fonts:
  provider: none
---
```

### Using fonts in content

Apply font classes anywhere: `font-sans`, `font-serif`, `font-mono`.

### Example for this presentation

```yaml
---
fonts:
  sans: Inter
  serif: Merriweather
  mono: JetBrains Mono
  weights: '400,600,700'
---
```

---

## 4. Layouts

Set via per-slide frontmatter: `layout: <name>`.

### All 18 built-in layouts

| Layout              | Description                                          | Props/Notes                              |
| ------------------- | ---------------------------------------------------- | ---------------------------------------- |
| `default`           | Basic content layout                                 | Used when no layout specified            |
| `center`            | Content centered on screen                           |                                          |
| `cover`             | Cover/title page                                     | Usually the first slide                  |
| `intro`             | Introduction slide with title + author               |                                          |
| `section`           | Section divider slide                                |                                          |
| `statement`         | Bold affirmation/statement                           |                                          |
| `fact`              | Prominent data/fact display                          |                                          |
| `quote`             | Styled quotation                                     |                                          |
| `end`               | Final slide                                          |                                          |
| `none`              | No styling at all                                    |                                          |
| `full`              | Full-screen, uses all space                          |                                          |
| `two-cols`          | Two-column layout                                    | Use `::right::` to separate columns      |
| `two-cols-header`   | Header + two columns below                           | Use `::left::` and `::right::` delimiters |
| `image`             | Full image as main content                           | `image: url`, `backgroundSize: cover`    |
| `image-left`        | Image left, content right                            | `image: url`, `class: my-class`          |
| `image-right`       | Image right, content left                            | `image: url`, `class: my-class`          |
| `iframe`            | Embed webpage as main content                        | `url: https://...`                       |
| `iframe-left`       | Webpage left, content right                          | `url: https://...`                       |
| `iframe-right`      | Webpage right, content left                          | `url: https://...`                       |

### Layout examples

**Two columns** (already used in the presentation):
```markdown
---
layout: two-cols
layoutClass: gap-8
---

# Left column content

::right::

# Right column content
```

**Image layout:**
```markdown
---
layout: image-right
image: /bookhive-screenshot.png
---

# Text on the left side
```

**Cover slide:**
```markdown
---
layout: cover
background: /gradient.jpg
---

# Talk Title
```

**Quote:**
```markdown
---
layout: quote
---

# "Store the maximally useful data."

— The core principle
```

**Fact/statement:**
```markdown
---
layout: fact
---

# 250,000+
book records on protocol
```

### Custom layouts

Place `.vue` files in a `layouts/` directory alongside `slides.md`. They become available by filename:

```
slides/
├── slides.md
└── layouts/
    └── my-custom.vue
```

Then use: `layout: my-custom`.

---

## 5. Backgrounds

### Image backgrounds

```yaml
---
background: /path-to-image.jpg
---
```

Or with a URL:
```yaml
---
background: https://source.unsplash.com/random/1920x1080
---
```

### Color backgrounds

```yaml
---
background: '#1a1a2e'
---
```

### Background with the `image` layout

```yaml
---
layout: image
image: /diagram.png
backgroundSize: contain
---
```

### Combining background + class

```yaml
---
background: /dark-texture.jpg
class: text-white
---
```

### Per-slide background with content overlay

The `background` frontmatter sets a full-slide background behind your content. Pair with `class: text-white` or other utility classes for contrast.

---

## 6. Styling & CSS

### Inline UnoCSS/utility classes

Slidev ships with UnoCSS (Tailwind-compatible utilities). Use them directly in HTML:

```html
<div class="text-3xl font-bold text-blue-500 mt-8">
  Big blue bold text
</div>
```

### Per-slide class

```yaml
---
class: text-center text-white bg-black
---
```

### Scoped slide styles

Add a `<style>` block at the end of any slide:

```markdown
---
layout: center
---

# My Styled Slide

<style>
h1 {
  background: linear-gradient(to right, #f97316, #ec4899);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
</style>
```

### Global styles

Create a `styles/` directory or `style.css` file next to `slides.md`:

```
slides/
├── slides.md
└── styles/
    └── index.css
```

The file is auto-imported. **Important:** global CSS also applies to presenter UI. Scope styles under `.slidev-layout` to avoid leaking:

```css
.slidev-layout {
  h1 {
    font-weight: 700;
    background: linear-gradient(120deg, #f97316, #ec4899);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
}
```

### UnoCSS in style blocks

You can use UnoCSS `--uno:` shorthand in CSS:

```css
.slidev-layout {
  --uno: px-14 py-10 text-[1.1rem];
}
```

### Theme config (CSS variables)

Pass custom values to the theme via `themeConfig` in headmatter:

```yaml
---
theme: seriph
themeConfig:
  primary: '#5d8aa8'
---
```

Check each theme's docs for supported variables.

---

## 7. Transitions & Animations

### Slide transitions

**Built-in transitions:** `fade`, `fade-out`, `slide-left`, `slide-right`, `slide-up`, `slide-down`, `view-transition`

Set globally:
```yaml
---
transition: slide-left
---
```

Override per-slide:
```yaml
---
transition: fade
---
```

Directional (different for forward/backward navigation):
```yaml
---
transition: slide-left | slide-right
---
```

### Click animations (v-click)

**As a component:**
```markdown
<v-click>

This appears on click.

</v-click>
```

**As a directive:**
```html
<div v-click>Appears on click</div>
```

**v-after** — appears at the same time as the previous v-click:
```html
<div v-click>Hello</div>
<div v-after>World (appears with Hello)</div>
```

**v-clicks** — auto-applies v-click to all children (great for lists):
```markdown
<v-clicks>

- Item 1
- Item 2
- Item 3

</v-clicks>
```

With `depth` for nested lists:
```html
<v-clicks depth="2">
  <li>Item 1
    <ul><li>Sub-item</li></ul>
  </li>
</v-clicks>
```

**Hide on click:**
```html
<div v-click.hide>This disappears on click</div>
```

**Specific click ordering:**
```html
<div v-click="3">Appears after 3rd click</div>
<div v-click="[2, 4]">Visible during clicks 2-3 only</div>
```

### Motion animations

Uses `@vueuse/motion`:

```html
<div
  v-motion
  :initial="{ x: -80, opacity: 0 }"
  :enter="{ x: 0, opacity: 1 }"
>
  Slides in from left
</div>
```

Click-triggered motion:
```html
<div
  v-motion
  :initial="{ x: -80 }"
  :click-1="{ x: 0, y: 30 }"
  :click-2="{ x: 50 }"
>
  Moves on specific clicks
</div>
```

### Custom transition CSS

Override animation styles globally:

```css
.slidev-vclick-target {
  transition: all 500ms ease;
}

.slidev-vclick-hidden {
  opacity: 0;
  transform: scale(0.8);
}
```

---

## 8. Components

### Built-in components

| Component         | Usage                                                   |
| ----------------- | ------------------------------------------------------- |
| `<v-click>`       | Click-to-reveal wrapper                                 |
| `<v-clicks>`      | Auto-applies v-click to children                        |
| `<Arrow>`         | Draw SVG arrows (for diagrams)                          |
| `<Tweet>`         | Embed tweets                                            |
| `<SlidevVideo>`   | Embed video                                             |
| `<Transform>`     | Scale/transform content                                 |
| `<LightOrDark>`   | Conditional render based on color scheme                |
| `<Link>`          | Navigate to specific slides                             |
| `<RenderWhen>`    | Conditional render based on context                     |
| `<Toc>`           | Table of contents                                       |

### Custom components

Place `.vue` or `.tsx` files in a `components/` directory:

```
slides/
├── slides.md
└── components/
    └── CatalogDiagram.vue
```

They're auto-registered and usable by filename (already used in the presentation as `<CatalogDiagram />`).

### Presenter notes

HTML comments become speaker notes:

```markdown
<!--
This is a speaker note visible in presenter mode.
Supports **markdown** and HTML.
-->
```

---

## 9. Directory Structure

All directories are optional. Place them alongside `slides.md`:

```
slides/
├── slides.md              # main entry
├── components/            # auto-registered Vue components
│   └── CatalogDiagram.vue
├── layouts/               # custom layout components
├── public/                # static assets (images, etc.)
├── styles/                # global CSS (index.css auto-imported)
│   └── index.css
├── setup/                 # custom setup hooks
├── snippets/              # code snippets
├── global-top.vue         # overlay rendered on top of all slides
├── global-bottom.vue      # overlay rendered below all slides
├── slide-top.vue          # rendered at top of each slide
├── slide-bottom.vue       # rendered at bottom of each slide
├── custom-nav-controls.vue # custom navigation controls
└── index.html             # HTML injections (meta tags, fonts, scripts)
```

### Static assets

Put images in `public/` and reference them with leading `/`:

```yaml
---
background: /my-bg.jpg
---
```

```markdown
![diagram](/diagram.png)
```

---

## 10. Display & Export Options

### Aspect ratio and canvas

```yaml
---
aspectRatio: '16/9'
canvasWidth: 980
---
```

For a wider feel:
```yaml
---
canvasWidth: 1200
---
```

### Color scheme

```yaml
---
colorSchema: dark
---
```

### Export to PDF

```yaml
---
download: true
export:
  format: pdf
  timeout: 30000
---
```

Or via CLI: `slidev export`

### Presenter mode

Press `P` during presentation or navigate to `/presenter`. Three layout options available.

### Drawing & annotations

Enable/disable in frontmatter:
```yaml
---
drawings:
  enabled: true
  persist: false
  syncAll: false
---
```

---

## Quick Recipes for This Presentation

### Add custom fonts

```yaml
---
theme: seriph
title: "Store the Maximally Useful Data"
fonts:
  sans: Inter
  mono: JetBrains Mono
  weights: '400,600,700'
transition: slide-left
---
```

### Use a dramatic fact slide

```markdown
---
layout: fact
---

# 250,000+
book records stored on protocol
```

### Add an image background to the title slide

```markdown
---
theme: seriph
background: /atproto-bg.jpg
class: text-white
---

# Store the Maximally Useful Data
```

### Make the "Day After" test slide more impactful

```markdown
---
layout: quote
---

> If BookHive disappeared tomorrow, is the data in your PDS still meaningful?
```

### Add gradient text to a heading

```markdown
---
layout: center
---

# A PDS Is Not a Database

<style>
h1 {
  background: linear-gradient(to right, #f97316, #ec4899);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-size: 3rem;
}
</style>
```
