# Genre emoji artwork

Unmodified 64px Apple emoji PNGs from `emoji-datasource-apple@15.0.1`, the Apple
image source used by Emoji Mart. Only the 56 images needed by the shared genre
mapping are bundled; neither the picker nor its full dataset is a runtime dependency.

Source: https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.0.1/img/apple/64/
Upstream: https://github.com/iamcal/emoji-data

Apple emoji artwork belongs to Apple Inc. The upstream project's MIT license for
its data and code does not grant a separate license to Apple's artwork. Review
artwork redistribution rights before publishing these bundled images.

These bundled images render the emoji selected by `src/core/genreEmoji.ts` without
depending on native emoji font availability. Filenames are hexadecimal Unicode
code points with variation selector FE0F omitted. No runtime network request is needed.
