# App landing screenshot provenance

These are genuine signed-in simulator captures selected for the `/app` marketing page
on 2026-11-17. They show the BookHive public account, not fabricated UI or sample
credentials. No sync-credential or private-file screen is included.

Source directory: `bookhive-release-media/website-bf7015de/` (local release media,
outside this repository). Captured from main `bf7015de`, Expo SDK 58, after account
re-sync and refreshing the iPad cache. These are development captures of the UI
published through EAS Update, not proof of a newly released store binary.

| Published stem | Source PNG         | Published size |
| -------------- | ------------------ | -------------- |
| `home`         | `home.png`         | 600 × 1304     |
| `my-books`     | `my-books.png`     | 560 × 1218     |
| `discover`     | `discover.png`     | 560 × 1218     |
| `profile`      | `profile.png`      | 560 × 1218     |
| `book-details` | `book-details.png` | 440 × 957      |
| `progress`     | `progress.png`     | 440 × 957      |
| `ipad-home`    | `ipad-home.png`    | 1240 × 1653    |

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

Combined WebP payload is approximately 182 KiB (186,520 bytes). Only Home is eager /
high-priority; the six below-the-fold images are lazy. Existing legacy screenshot
assets are retained to avoid deleting unrelated material, but `/app` no longer uses them.
