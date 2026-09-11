# Fount vector master

Reconstructed from `Logotype.png`. The deliverables contain vector paths only, with no bitmap, live font dependency, SVG filter or external resource.

| Asset                                     | Use                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `core/src/web/assets/fount-mark.svg`      | Color symbol, 480 × 480 coordinate system                            |
| `core/src/web/assets/fount-mark-mono.svg` | Single-color symbol                                                  |
| `core/src/web/assets/fount-logo.svg`      | Full symbol and outlined Fount wordmark, 520 × 660 coordinate system |
| `core/src/web/favicon.svg`                | Browser icon, same master geometry                                   |

The upright runs between x=104 and x=196. The top aligns to y=32, the foot to y=452, and the middle arm to y=248 and y=284. These are geometric alignments, not coordinates estimated independently for separate copies.

The F and blue fold reuse the same cubic edge from (268,32) to (300,64), with control points (285.673112,32) and (300,46.326888). The edge begins horizontally and ends vertically. Reusing this edge avoids mismatched shapes along the fold. Bracketed curves join the stem with vertical tangents; the internal horizontal arm joins with horizontal tangents. The pointer is a separate closed contour. Ink is `#202020`; fold blue is `#548fe7`.

The wordmark is converted from the already bundled Geist SemiBold into SVG outlines. It remains identical on computers without that font. `python scripts/build-brand.py` regenerates all four assets; the optional asset-authoring script uses the installed fontTools package. The application does not require Python or fontTools to run.

A raster image does not uniquely specify the original Bézier curves, optical corrections or original typeface. This is a deliberately clean reconstruction with exact, repeatable coordinates. It is not a claim that the original source vectors were recovered, or that every rasterizer produces identical antialiasing at every size.

Rendered proof: `output/reference-redesign/brand-proof.png`. Portable delivery: `output/reference-redesign/Fount-vector-assets.zip`.
