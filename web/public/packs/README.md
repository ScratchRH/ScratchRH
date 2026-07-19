# Pack art

Drop pack videos here with these exact filenames — `PackCard` picks
them up automatically (falls back to an emoji if a file is missing):

- `penny.mp4`
- `classic.mp4`
- `whale.mp4`

Specs: MP4 (H.264), 5:7 aspect ratio, full-bleed art (no need to leave
room for text — the ribbon, brand mark, and price tag render as
overlays on top with a scrim for legibility). Plays autoplay/loop/muted.

If you generate a GIF instead, convert it first — GIFs from AI tools
are often 10-20x larger than an equivalent H.264 video:

```
ffmpeg -i input.gif -movflags faststart -pix_fmt yuv420p \
  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -crf 23 output.mp4
```
