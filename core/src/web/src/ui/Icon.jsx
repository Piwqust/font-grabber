// One stroked icon set, drawn on a 24-unit grid so every glyph shares a weight.
// Icons are decorative by default; give the control the accessible name.

const PATHS = {
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  link: (
    <path
      d="m10 13 4-4M8 15l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 4 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"
      transform="translate(2 0)"
    />
  ),
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
  arrowRight: <path d="M4 12h15m-6-6 6 6-6 6" />,
  arrowLeft: <path d="M20 12H5m6-6-6 6 6 6" />,
  arrowUpRight: <path d="M7 17 17 7m-7 0h7v7" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m4 12 5 5L20 6" />,
  layers: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <rect x="12" y="12" width="17" height="17" rx="3" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" />
      <circle cx="15" cy="17" r="3" />
    </>
  ),
  refresh: <path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" />,
  undo: <path d="M4 12a8 8 0 1 0 8-8 8 8 0 0 0-6 2.7L4 9M4 4v5h5" />,
  pencil: <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />,
  upload: <path d="M12 16V4m-5 5 5-5 5 5M4 15v5h16v-5" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18M5 6.5h14M5 17.5h14" />
    </>
  ),
  file: (
    <>
      <path d="M6 2h8l5 5v15H6Z" />
      <path d="M14 2v6h5" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  list: <path d="M4 6h16M4 12h16M4 18h16" />,
  puzzle: (
    <path d="M10 4a2 2 0 1 1 4 0v1h4a1 1 0 0 1 1 1v4h1a2 2 0 1 1 0 4h-1v4a1 1 0 0 1-1 1h-4v-1a2 2 0 1 0-4 0v1H6a1 1 0 0 1-1-1v-4H4a2 2 0 1 1 0-4h1V6a1 1 0 0 1 1-1h4Z" />
  ),
  spark: (
    <path d="M12 3v5m0 8v5M3 12h5m8 0h5M6 6l3 3m6 6 3 3m0-12-3 3m-6 6-3 3" />
  ),
  type: <path d="M4 6V4h16v2m-8-2v16m-4 0h8" />,
  shield: (
    <>
      <path d="M12 3 5 6v6c0 5 3 8 7 9 4-1 7-4 7-9V6Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  github: (
    <path d="M8 21v-4c-4 1-4-2-6-2m14 6v-4c0-1-.5-2-1-2 4-.5 6-2 6-6 0-2-1-3-2-4 0-1 0-2-.5-3-2 0-3 1-4 2a13 13 0 0 0-5 0C8 3 7 2 5 2c-.5 1-.5 2-.5 3C3 6 2 7 2 9c0 4 2 5.5 6 6-1 1-1 2-1 3v3" />
  ),
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </>
  ),
  cursor: <path d="m5 3 14 8-6 1.5L10 19Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
};

export function Icon({ name, size = 20, class: className = "", ...rest }) {
  const glyph = PATHS[name];
  if (!glyph) return null;
  return (
    <svg
      class={`icon ${className}`.trim()}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {glyph}
    </svg>
  );
}

export const iconNames = Object.keys(PATHS);
