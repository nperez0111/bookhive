import sharp from "sharp";

const BOOK_PATHS = `<g transform="matrix(1,0,0,1,-582,0)">
  <g transform="matrix(1,0,0,0.930233,0,0)">
    <clipPath id="_avatarClipOuter"><rect x="582" y="0" width="532" height="688"/></clipPath>
    <g clip-path="url(#_avatarClipOuter)">
      <g transform="matrix(1,0,0,1.075,583,2.15)">
        <path d="M69.206,-0.401L74.811,-0.421C79.934,-0.437 477.771,-0.775 482.777,-0.749C484.586,-0.744 486.394,-0.749 488.202,-0.766C500.414,-0.872 508.21,0.67 518.086,8.422C523.409,13.836 527.156,18.949 530,26L531.043,28.155C532.253,31.749 532.274,35.095 532.249,38.84L532.257,41.225C532.263,43.872 532.255,46.518 532.247,49.165C532.261,56.342 532.144,468.264 532.136,473.394L532.136,478.984C532.138,481.501 532.134,484.019 532.129,486.537L532.135,488.767C532.115,516.772 515,514 515,514C515,514 515.798,607.724 515.795,611.064L515.871,614.026C515.793,627.501 512.567,638.12 493.056,638.136L76.096,637.027C60.215,637.062 -0.146,638.441 -0.14,568.99L-0.149,566.296C-0.157,563.313 -0.159,560.331 -0.161,557.348C-0.161,557.348 -0.751,74.075 -0.755,71.984C-0.904,-1.214 61.311,-0.424 69.205,-0.4L69.206,-0.401Z" fill="rgb(33,14,3)" fill-rule="nonzero"/>
        <clipPath id="_avatarClipBook"><path d="M69.206,-0.401L74.811,-0.421C79.934,-0.437 477.771,-0.775 482.777,-0.749C484.586,-0.744 486.394,-0.749 488.202,-0.766C500.414,-0.872 508.21,0.67 518.086,8.422C523.409,13.836 527.156,18.949 530,26L531.043,28.155C532.253,31.749 532.274,35.095 532.249,38.84L532.257,41.225C532.263,43.872 532.255,46.518 532.247,49.165C532.261,56.342 532.144,468.264 532.136,473.394L532.136,478.984C532.138,481.501 532.134,484.019 532.129,486.537L532.135,488.767C532.115,516.772 515,514 515,514C515,514 515.798,607.724 515.795,611.064L515.871,614.026C515.793,627.501 512.567,638.12 493.056,638.136L76.096,637.027C60.215,637.062 -0.146,638.441 -0.14,568.99L-0.149,566.296C-0.157,563.313 -0.159,560.331 -0.161,557.348C-0.161,557.348 -0.751,74.075 -0.755,71.984C-0.904,-1.214 61.311,-0.424 69.205,-0.4L69.206,-0.401Z" clip-rule="nonzero"/></clipPath>
        <g clip-path="url(#_avatarClipBook)">
          <path d="M83.492,25.063C105.45,24.257 448.229,23.876 469.229,23.87C503.651,23.859 506.391,28.909 506.265,59.561C506.12,95.274 506.687,369.978 507.006,466.372C507.082,489.32 502.798,495.161 482,496C473.063,496.361 145.715,497.257 83.696,496.488L83.492,25.063Z" fill="rgb(204,121,53)" fill-rule="nonzero"/>
          <path d="M83.065,519.64C89.589,519.624 434.773,519.933 487,520L485.751,523.225L484.113,527.512L483.293,529.626C480.633,536.62 479.139,543.598 478,551L477.566,553.645C475.083,573.114 478.367,593.415 487,611L487,613C445.334,613.053 68.737,613.065 68.737,613.065C52.877,612.807 28.353,604.098 27.871,566.676C28.384,553.79 33.482,542.59 42,533C44.513,530.698 47.111,528.801 50,527L51.742,525.86C61.892,519.591 71.596,519.575 83.065,519.64Z" fill="rgb(246,232,197)" fill-rule="nonzero"/>
          <path d="M59.181,25.404L58.984,30.301C58.966,34.361 59.111,493.346 58,497C40.377,500.207 35,506 25,515L25,514C24.792,449.779 24.046,79.281 24,77.473C22.802,30.401 49.127,26.281 59.181,25.404Z" fill="rgb(205,120,53)" fill-rule="nonzero"/>
        </g>
      </g>
    </g>
  </g>
</g>`;

export function getInitials(handle: string): string {
  const cleaned = handle.replace(/\.bookhive\.social$/i, "").trim();
  const parts = cleaned.split(/[-_.]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
    }
    return c;
  });
}

function buildAvatarSvg(initials: string): string {
  const text = escapeXml(initials);
  const fontSize = initials.length > 1 ? 220 : 280;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="640" height="640">
  <rect width="640" height="640" fill="rgb(246,232,197)"/>
  <g transform="translate(54,0)">${BOOK_PATHS}</g>
  <text x="349" y="263" dy="0.35em" text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif" font-weight="900"
    font-size="${fontSize}" fill="rgb(33,14,3)">${text}</text>
</svg>`;
}

export async function generateInitialsAvatar(handle: string): Promise<Blob> {
  const svg = buildAvatarSvg(getInitials(handle));
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Blob([new Uint8Array(png)], { type: "image/png" });
}
