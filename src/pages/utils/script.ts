import { html, raw } from "hono/html";
import type { FC } from "hono/jsx";

export const Script: FC<{
  script: (document: Document) => void;
  onDomContentLoaded?: boolean;
}> = ({ script: interactivity, onDomContentLoaded = true }) => {
  /* What a hack to get nice highlighting of interactive JS */
  // Build the IIFE body as a single raw string. Keeping the `(fn)(document)`
  // call inside one interpolation (rather than wrapping a `${...}` in literal
  // parens) prevents oxfmt from inserting a trailing comma that would otherwise
  // produce invalid `(expr,)` JavaScript in the generated <script>.
  const body = `(${interactivity.toString()})(document);`;
  return html`<script type="text/javascript" defer>
    ${onDomContentLoaded ? raw`document.addEventListener("DOMContentLoaded", function () {` : ""};
    ${raw(body)};
    ${onDomContentLoaded ? raw`});` : ""};
  </script>`;
};
