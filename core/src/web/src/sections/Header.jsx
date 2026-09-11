import { useEffect, useState } from "preact/hooks";
import { useStore, HOSTED } from "../store.jsx";
import { useMediaQuery } from "../lib/motion.js";
import { readLocal, writeLocal } from "../lib/storage.js";
import { Button, IconButton } from "../ui/Button.jsx";
import { Icon } from "../ui/Icon.jsx";
import { Tooltip } from "../ui/Tooltip.jsx";

const THEME_KEY = "fount-theme";

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
 * The header condenses once the page scrolls: the rule appears, the padding
 * tightens. Nothing moves horizontally, so the wordmark and the primary action
 * stay where they were first seen.
 */
export function Header() {
  const store = useStore();
  const [condensed, setCondensed] = useState(false);
  const [theme, setTheme] = useTheme();
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const dark = theme === "system" ? systemDark : theme === "dark";

  // On the landing page the address field is the hero, so a header button that
  // only focuses a field already centred on screen does nothing worth doing.
  // It appears once the field has scrolled away.
  const [fieldOnScreen, setFieldOnScreen] = useState(true);

  useEffect(() => {
    const onScroll = () => setCondensed(scrollY > 12);
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (store.hasResults) return;
    const field = document.getElementById("url");
    if (!field || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      ([entry]) => setFieldOnScreen(entry.isIntersecting),
      { threshold: 0.5 },
    );
    observer.observe(field);
    return () => observer.disconnect();
  }, [store.hasResults]);

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
        <img src="/assets/fount-mark.svg" width="30" height="30" alt="" />
        <span>Fount</span>
      </a>

      {/* The section links only lead somewhere on the landing page; in the
          catalogue those sections are not in the document. */}
      {store.hasResults ? (
        <span class="header-context">{store.collectionLabel}</span>
      ) : (
        <nav class="header-nav" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#capabilities">What you get</a>
          <a href="#extension">Extension</a>
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

        {store.hasResults ? (
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
