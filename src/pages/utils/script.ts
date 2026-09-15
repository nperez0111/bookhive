import { html, raw } from "hono/html";
import type { FC } from "hono/jsx";

export const Script: FC<{
  script: (document: Document) => void;
  onDomContentLoaded?: boolean;
}> = ({ script: interactivity, onDomContentLoaded = true }) => {
  /* What a hack to get nice highlighting of interactive JS */
  // Kept inside one interpolation rather than wrapping `${...}` in literal parens — the latter lets oxfmt insert a trailing comma, producing invalid `(expr,)` JS in the generated <script>.
  const body = `(${interactivity.toString()})(document);`;
  return html`<script type="text/javascript" defer>
    ${onDomContentLoaded ? raw`document.addEventListener("DOMContentLoaded", function () {` : ""};
    ${raw(body)};
    ${onDomContentLoaded ? raw`});` : ""};
  </script>`;
};
