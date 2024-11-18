/** @jsx createElement */
import { html, raw } from "hono/html";
// @ts-expect-error
import { type FC, createElement } from "hono/jsx";

export const Script: FC<{
  script: (document: Document) => void;
  onDomContentLoaded?: boolean;
}> = ({ script: interactivity, onDomContentLoaded = true }) => {
  /* What a hack to get nice highlighting of interactive JS */
  return html`<script type="text/javascript" defer>
    ${onDomContentLoaded
      ? raw`document.addEventListener("DOMContentLoaded", function () {`
      : ""}(${raw(interactivity.toString())})(document);
    ${onDomContentLoaded ? `});` : ""};
  </script>`;
};
