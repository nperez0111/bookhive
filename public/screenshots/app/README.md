# App landing screenshot provenance

These are genuine signed-in simulator captures selected for the `/app` marketing page
on 2026-11-15. They show the BookHive public account, not fabricated UI or sample
credentials. No sync-credential or private-file screen is included.

Source gallery: `bookhive-release-media/main-9c3b4768/index.html` (local release media,
outside this repository). The initial capture used merged main `9c3b4768`, Expo SDK
58, after account re-sync; `*-refined-*` captures include the subsequent local iPad
responsive work and iPhone regression checks. These are development captures, not
proof that a store binary containing these changes has been released.

| Published stem | Source PNG                     | Published size |
| -------------- | ------------------------------ | -------------- |
| `home`         | `iphone-refined-home.png`      | 600 × 1304     |
| `my-books`     | `iphone-refined-my-books.png`  | 560 × 1218     |
| `discover`     | `iphone-refined-discover.png`  | 560 × 1218     |
| `profile`      | `14-profile-light.png`         | 560 × 1218     |
| `book-details` | `07-book-details.png`          | 440 × 957      |
| `progress`     | `18-progress-editor-light.png` | 440 × 957      |
| `ipad-home`    | `ipad-refined-home.png`        | 1240 × 1653    |

All seven source images were visually reviewed before selection. The progress
editor is unsaved; no reading data was modified for this page. Captures retain
their full composition and aspect ratio, with no reconstructed text or UI.

PNG fallbacks are proportionally downscaled, stripped of metadata and losslessly
compressed, rather than shipping the multi-megabyte originals. Phone widths are
twice their maximum CSS slots (300/280/220px); iPad is twice its 620px slot.
WebP versions were generated from these PNGs using:

```sh
magick SOURCE.png -resize WIDTHx -strip -define png:compression-level=9 NAME.png
cwebp -preset picture -q 80 -m 6 NAME.png -o NAME.webp
```

Combined WebP payload is approximately 225 KiB (230,114 bytes). Only Home is eager /
high-priority; the six below-the-fold images are lazy. Existing legacy screenshot
assets are retained to avoid deleting unrelated material, but `/app` no longer uses them.
