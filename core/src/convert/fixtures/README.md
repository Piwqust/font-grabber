Test fixtures for `merge.rs`, cut with `pyftsubset` from the fonts the web UI
already ships (both SIL Open Font License 1.1):

- `tt-core.woff2`, `tt-ext.woff2`: IBM Plex Mono Regular (TrueType, hinted),
  split into U+20-7E and U+A0-17F,U+2010-2027.
- `cff-core.woff2`, `cff-ext.woff2`: Geist Regular (CFF), split the same way,
  for the "cannot be joined" path.
- `tt-ext-a.woff2`, `tt-ext-b.woff2`: the first and the last 70 characters of
  `tt-ext`, overlapping by 31, like a font service's Latin Extended and
  Vietnamese files.
