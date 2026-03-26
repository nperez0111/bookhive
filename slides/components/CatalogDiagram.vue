<template>
  <div class="catalog-diagram">
    <svg viewBox="0 0 720 340" xmlns="http://www.w3.org/2000/svg">
      <!-- Data sources on the left -->
      <g :class="['node', 'sources', { visible: step >= 1 }]">
        <rect x="10" y="30" width="140" height="40" rx="6" class="box source" />
        <text x="80" y="55" class="label">Goodreads</text>
        <rect x="10" y="80" width="140" height="40" rx="6" class="box source" />
        <text x="80" y="105" class="label">Google Books</text>
        <rect x="10" y="130" width="140" height="40" rx="6" class="box source" />
        <text x="80" y="155" class="label">ISBNdb</text>
      </g>

      <!-- Arrow: sources -> BookHive -->
      <g :class="['arrow', { visible: step >= 2 }]">
        <line x1="155" y1="100" x2="220" y2="100" class="connector" />
        <polygon points="218,94 230,100 218,106" class="arrowhead" />
      </g>

      <!-- BookHive enrichment -->
      <g :class="['node', 'enricher', { visible: step >= 2 }]">
        <rect x="235" y="70" width="160" height="60" rx="8" class="box enricher-box" />
        <text x="315" y="97" class="label bold">BookHive</text>
        <text x="315" y="113" class="label small">scrape + enrich</text>
      </g>

      <!-- Arrow: BookHive -> Catalog -->
      <g :class="['arrow', { visible: step >= 3 }]">
        <line x1="400" y1="100" x2="465" y2="100" class="connector" />
        <polygon points="463,94 475,100 463,106" class="arrowhead" />
      </g>

      <!-- Catalog account (center-right) -->
      <g :class="['node', 'catalog', { visible: step >= 3 }]">
        <rect x="480" y="55" width="220" height="90" rx="10" class="box catalog-box" />
        <text x="590" y="85" class="label bold">@bookhive.buzz</text>
        <text x="590" y="103" class="label small">catalog records</text>
        <text x="590" y="119" class="label small accent">on protocol</text>
      </g>

      <!-- User PDS (bottom-left) -->
      <g :class="['node', 'user-pds', { visible: step >= 4 }]">
        <rect x="170" y="220" width="200" height="80" rx="8" class="box user-box" />
        <text x="270" y="250" class="label bold">User's PDS</text>
        <text x="270" y="268" class="label small">title, authors, ISBN...</text>
        <text x="270" y="284" class="label small dim">hiveBookUri</text>
      </g>

      <!-- Arrow: User PDS -> Catalog (reference link) -->
      <g :class="['arrow', 'ref-arrow', { visible: step >= 4 }]">
        <path d="M 370 260 Q 450 260 500 180 L 510 160" fill="none" class="connector dashed" />
        <polygon points="506,163 513,152 517,164" class="arrowhead ref" />
      </g>

      <!-- Other apps (bottom-right) -->
      <g :class="['node', 'other-apps', { visible: step >= 5 }]">
        <rect x="480" y="220" width="200" height="80" rx="8" class="box app-box" />
        <text x="580" y="250" class="label bold">Other Apps</text>
        <text x="580" y="268" class="label small">Popfeed, websites...</text>
        <text x="580" y="284" class="label small accent">read both freely</text>
      </g>

      <!-- Arrow: Other apps -> User PDS -->
      <g :class="['arrow', { visible: step >= 5 }]">
        <line x1="478" y1="260" x2="375" y2="260" class="connector app-conn" />
        <polygon points="377,254 365,260 377,266" class="arrowhead app" />
      </g>

      <!-- Arrow: Other apps -> Catalog -->
      <g :class="['arrow', { visible: step >= 5 }]">
        <line x1="560" y1="218" x2="575" y2="150" class="connector app-conn" />
        <polygon points="569,152 578,141 581,153" class="arrowhead app" />
      </g>
    </svg>
  </div>
</template>

<script setup>
import { ref, onUnmounted } from 'vue'
import { onSlideEnter, onSlideLeave } from '@slidev/client'

const step = ref(0)
let interval = null

function animate() {
  step.value = 0
  interval = setInterval(() => {
    if (step.value < 5) {
      step.value++
    } else {
      clearInterval(interval)
    }
  }, 600)
}

onSlideEnter(() => {
  animate()
})

onSlideLeave(() => {
  clearInterval(interval)
  step.value = 0
})

onUnmounted(() => {
  clearInterval(interval)
})
</script>

<style scoped>
.catalog-diagram {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
}

svg {
  width: 100%;
  height: auto;
}

.node, .arrow {
  opacity: 0;
  transition: opacity 0.5s ease;
}

.node.visible, .arrow.visible {
  opacity: 1;
}

.box {
  stroke-width: 1.5;
}

/* Data sources — muted brown */
.source {
  fill: #5c3d10;
  stroke: #93710d;
}

/* BookHive — amber accent */
.enricher-box {
  fill: #5c3d10;
  stroke: #f59e0b;
}

/* Catalog — bold gold border */
.catalog-box {
  fill: #4a3008;
  stroke: #eac741;
  stroke-width: 2;
}

/* User PDS — warm green-brown */
.user-box {
  fill: #3b3510;
  stroke: #a38c1e;
}

/* Other apps — warm purple-brown */
.app-box {
  fill: #3b2a18;
  stroke: #c49a6c;
}

/* Text */
.label {
  fill: #fafaf9;
  text-anchor: middle;
  font-size: 14px;
  font-family: inherit;
}

.label.bold {
  font-weight: 600;
  font-size: 15px;
}

.label.small {
  font-size: 11px;
  fill: #d4a017;
}

.label.small.accent {
  fill: #eac741;
}

.label.small.dim {
  fill: #93710d;
}

/* Connectors — warm tones */
.connector {
  stroke: #93710d;
  stroke-width: 1.5;
}

.connector.dashed {
  stroke-dasharray: 5 3;
  stroke: #a3841a;
}

.connector.app-conn {
  stroke: #c49a6c;
}

.arrowhead {
  fill: #93710d;
}

.arrowhead.ref {
  fill: #a3841a;
}

.arrowhead.app {
  fill: #c49a6c;
}
</style>
