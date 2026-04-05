<template>
  <div class="catalog-diagram">
    <svg viewBox="0 0 780 400" xmlns="http://www.w3.org/2000/svg">
      <!-- Alice's PDS (full detail) -->
      <g :class="['node', { visible: step >= 1 }]">
        <rect x="5" y="20" width="250" height="130" rx="10" class="box user-box" />
        <text x="130" y="46" class="label tag user-tag">Alice's PDS</text>
        <rect x="21" y="56" width="218" height="84" rx="6" class="box record user-record" />
        <text x="52" y="76" class="label field">
          <tspan class="key">title:</tspan>
          "Bee Movie"
        </text>
        <text x="52" y="94" class="label field">
          <tspan class="key">status:</tspan>
          "finished"
        </text>
        <text x="52" y="112" class="label field">
          <tspan class="key">stars:</tspan>
          10
        </text>
        <text x="52" y="130" class="label field uri">
          <tspan class="key">hiveBookUri:</tspan>
          at://...
        </text>
      </g>

      <!-- Bob's PDS (minimal) -->
      <g :class="['node', { visible: step >= 2 }]">
        <rect x="285" y="20" width="210" height="100" rx="10" class="box user-box" />
        <text x="390" y="46" class="label tag user-tag">Bob's PDS</text>
        <rect x="301" y="56" width="178" height="54" rx="6" class="box record user-record" />
        <text x="332" y="78" class="label field"><tspan class="key">user-book</tspan></text>
        <text x="332" y="96" class="label field uri">
          <tspan class="key">hiveBookUri:</tspan>
          at://...
        </text>
      </g>

      <!-- Carol's PDS (minimal) -->
      <g :class="['node', { visible: step >= 2 }]">
        <rect x="525" y="20" width="210" height="100" rx="10" class="box user-box" />
        <text x="630" y="46" class="label tag user-tag">Carol's PDS</text>
        <rect x="541" y="56" width="178" height="54" rx="6" class="box record user-record" />
        <text x="562" y="78" class="label field"><tspan class="key">user-book</tspan></text>
        <text x="562" y="96" class="label field uri">
          <tspan class="key">hiveBookUri:</tspan>
          at://...
        </text>
      </g>

      <!-- BookHive Catalog PDS -->
      <g :class="['node', { visible: step >= 3 }]">
        <rect x="250" y="230" width="280" height="160" rx="10" class="box catalog-box" />
        <text x="390" y="256" class="label tag">@bookhive.buzz PDS</text>
        <rect x="266" y="266" width="248" height="114" rx="6" class="box record catalog-record" />
        <text x="282" y="286" class="label field key">catalogBook</text>
        <text x="282" y="306" class="label field">
          <tspan class="key">title:</tspan>
          "Bee Movie"
        </text>
        <text x="282" y="324" class="label field">
          <tspan class="key">description:</tspan>
          "Best movie ever..."
        </text>
        <text x="282" y="342" class="label field">
          <tspan class="key">authors:</tspan>
          "Susan Korman"
        </text>
        <text x="282" y="360" class="label field dim">
          <tspan class="key">genres, series, isbn...</tspan>
        </text>
      </g>

      <!-- Arrows -->
      <g :class="['arrow', { visible: step >= 4 }]">
        <!-- Alice → Catalog (rotated 45deg clockwise) -->
        <path d="M 130 150 C 130 185 280 200 310 218" fill="none" class="connector dashed" />
        <g transform="rotate(45, 310, 218)">
          <polygon points="304,213 310,224 315,212" class="arrowhead" />
        </g>
        <!-- Bob → Catalog -->
        <path d="M 390 120 L 390 212" fill="none" class="connector dashed" />
        <polygon points="384,210 390,221 396,210" class="arrowhead" />
        <!-- Carol → Catalog (rotated 45deg counter-clockwise) -->
        <path d="M 620 120 C 620 185 500 200 470 218" fill="none" class="connector dashed" />
        <g transform="rotate(-45, 470, 218)">
          <polygon points="465,212 470,224 476,213" class="arrowhead" />
        </g>
      </g>
    </svg>
  </div>
</template>

<script setup>
import { ref, onUnmounted } from "vue";
import { onSlideEnter, onSlideLeave } from "@slidev/client";

const step = ref(0);
let interval = null;

function animate() {
  step.value = 0;
  interval = setInterval(() => {
    if (step.value < 4) {
      step.value++;
    } else {
      clearInterval(interval);
    }
  }, 600);
}

onSlideEnter(() => {
  animate();
});

onSlideLeave(() => {
  clearInterval(interval);
  step.value = 0;
});

onUnmounted(() => {
  clearInterval(interval);
});
</script>

<style scoped>
.catalog-diagram {
  width: 100%;
  max-width: 780px;
  margin: 0 auto;
}

svg {
  width: 100%;
  height: auto;
}

.node,
.arrow {
  opacity: 0;
  transition: opacity 0.5s ease;
}

.node.visible,
.arrow.visible {
  opacity: 1;
}

/* Outer boxes — catalog uses accent (amber-400), user uses sand */
.catalog-box {
  fill: rgb(251 191 36); /* --accent: amber-400 */
  stroke: rgb(217 119 6); /* --primary: amber-600 */
  stroke-width: 2;
}

.user-box {
  fill: rgb(249 234 188); /* --background: sand */
  stroke: rgb(229 213 160); /* --border */
  stroke-width: 1.5;
}

/* Inner record boxes */
.record {
  stroke-width: 1;
}

.catalog-record {
  fill: rgb(254 252 232); /* --card: yellow-50 */
  stroke: rgb(217 119 6); /* --primary */
}

.user-record {
  fill: rgb(254 249 195); /* --muted: yellow-100 */
  stroke: rgb(229 213 160); /* --border */
}

/* Tags (PDS labels) */
.tag {
  fill: rgb(63 43 8); /* --accent-foreground: amber-950 */
  font-size: 13px;
  font-weight: 700;
  font-family: inherit;
  text-anchor: middle;
}

.user-tag {
  fill: rgb(146 64 14); /* --secondary: amber-800 */
}

/* Field text */
.label.field {
  fill: rgb(28 25 23); /* --foreground: stone-900 */
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  text-anchor: start;
}

.label.field .key {
  fill: rgb(146 64 14); /* --secondary: amber-800 */
  font-weight: 600;
}

.label.field.dim {
  fill: rgb(120 113 108); /* --muted-foreground: stone-500 */
}

.label.field.dim .key {
  fill: rgb(120 113 108); /* --muted-foreground */
}

.label.field.uri {
  fill: rgb(217 119 6); /* --primary: amber-600 */
}

.label.field.uri .key {
  fill: rgb(217 119 6); /* --primary */
}

/* Connectors */
.connector.dashed {
  stroke: rgb(217 119 6); /* --primary: amber-600 */
  stroke-width: 1.5;
  stroke-dasharray: 5 3;
}

.arrowhead {
  fill: rgb(217 119 6); /* --primary */
}
</style>
