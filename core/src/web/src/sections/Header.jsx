import { useEffect, useRef, useState } from "preact/hooks";
import { useStore, HOSTED } from "../store.jsx";
import { useMediaQuery } from "../lib/motion.js";
import { readLocal, writeLocal } from "../lib/storage.js";
import { Button, IconButton } from "../ui/Button.jsx";
import { Icon } from "../ui/Icon.jsx";
import { Mark } from "../ui/Logo.jsx";
import { Tooltip } from "../ui/Tooltip.jsx";

const THEME_KEY = "fount-theme";

const SECTIONS = [
  { id: "how", label: "How it works" },
  { id: "capabilities", label: "What you get" },
  { id: "playground", label: "Try it" },
  { id: "extension", label: "Extension" },
];

/**
 * Which landing section is under the top third of the window. Drives the
 * underline in the header so the navigation reads as a position, not just a
 * list of links.
 */
function useActiveSection(enabled) {
  const [active, setActive] = useState("");
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver !== "function") {
      setActive("");
      return;
    }
    const nodes = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      Boolean,
    );
    if (!nodes.length) return;
    const visible = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          visible.set(entry.target.id, entry.isIntersecting);
        // The hero has no link, so nothing is active while it fills the top.
        const first = SECTIONS.find((s) => visible.get(s.id));
        setActive(first ? first.id : "");
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);
  return active;
}

/**
 * Light, dark, or whatever the system asks for. The choice is written to the
 * root element, which is also what the inline script in index.html sets before
 * the first paint — so a saved theme never flashes the other palette.
 */
function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = readLocal(THEME_KEY, "system");
    return saved === "dark" || saved === "light" ? saved : "system";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    writeLocal(THEME_KEY, theme);
  }, [theme]);

  return [theme, setTheme];
}

/**
 * The header keeps one height at all times. Scrolling only adds the rule and
 * the blur: changing its height on scroll changes the document height, which
 * moves the scroll position, which flips the state back; the page then shakes
 * by the difference. Nothing moves horizontally either, so the
 * wordmark and the primary action stay where they were first seen.
 */
export function Header() {
  const store = useStore();
  const [condensed, setCondensed] = useState(false);
  const [theme, setTheme] = useTheme();
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const dark = theme === "system" ? systemDark : theme === "dark";
  const editing = store.metadata.open;
  const active = useActiveSection(!store.hasResults && !editing);

  // On the landing page the address field is the hero, so a header button that
  // only focuses a field already centred on screen does nothing worth doing.
  // It appears once the field has scrolled away.
  const [fieldOnScreen, setFieldOnScreen] = useState(true);
  const frame = useRef(0);

  useEffect(() => {
    // Hysteresis: the rule appears past 24px and only leaves under 4px, so a
    // scroll position resting on the threshold cannot flicker it.
    const onScroll = () => {
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        setCondensed((was) => (was ? scrollY > 4 : scrollY > 24));
      });
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, []);

  useEffect(() => {
    if (store.hasResults || editing) return;
    const field = document.getElementById("url");
    if (!field || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      ([entry]) => setFieldOnScreen(entry.isIntersecting),
      { threshold: 0.5 },
    );
    observer.observe(field);
    return () => observer.disconnect();
  }, [store.hasResults, editing]);

  const home = (event) => {
    event.preventDefault();
    store.clearResults();
    scrollTo({ top: 0, behavior: "instant" });
  };

  const toField = () => {
    const field = document.getElementById("url");
    field?.scrollIntoView({ block: "center" });
    field?.focus();
  };

  return (
    <header class="site-header" data-condensed={String(condensed)}>
      <a class="wordmark" href="/" onClick={home} aria-label="Fount home">
        <Mark size={30} />
        <span>Fount</span>
      </a>

      {/* The section links only lead somewhere on the landing page; in the
          catalogue and the editor those sections are not in the document. */}
      {editing ? (
        <span class="header-context">
          {store.metadata.fonts.length
            ? `Editing ${store.metadata.fonts.length} file${store.metadata.fonts.length === 1 ? "" : "s"}`
            : "Editing metadata"}
        </span>
      ) : store.hasResults ? (
        <span class="header-context">{store.collectionLabel}</span>
      ) : (
        <nav class="header-nav" aria-label="Sections">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              aria-current={active === section.id ? "true" : undefined}
            >
              {section.label}
            </a>
          ))}
        </nav>
      )}

      <div class="header-end">
        {/* Below the button: the header is against the top of the window. */}
        <Tooltip
          placement="bottom"
          text={dark ? "Switch to the light theme" : "Switch to the dark theme"}
        >
          <IconButton
            icon={dark ? "sun" : "moon"}
            size="s"
            label={dark ? "Switch to the light theme" : "Switch to the dark theme"}
            onClick={() => setTheme(dark ? "light" : "dark")}
          />
        </Tooltip>

        <a
          class="header-link"
          href="https://github.com/Piwqust/font-grabber"
          target="_blank"
          rel="noopener"
          aria-label="Fount on GitHub"
        >
          <Icon name="github" size={18} />
        </a>

        {editing ? (
          <Button
            variant="outline"
            size="s"
            icon="arrowLeft"
            onClick={store.closeMetadata}
          >
            {store.metadata.source?.kind === "upload" && !store.hasResults
              ? "New file"
              : "Back to results"}
          </Button>
        ) : store.hasResults ? (
          <Button variant="outline" size="s" onClick={home}>
            New scan
          </Button>
        ) : fieldOnScreen ? null : (
          <Button variant="solid" size="s" iconEnd="arrowRight" onClick={toField}>
            Scan a site
          </Button>
        )}
        <span class="edition">{HOSTED ? "Hosted" : "Local"}</span>
      </div>
    </header>
  );
}
