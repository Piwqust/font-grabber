import { useEffect, useRef, useState } from "preact/hooks";
import { useStore, HOSTED } from "../store.jsx";
import { useMediaQuery } from "../lib/motion.js";
import { readLocal, writeLocal } from "../lib/storage.js";
import { Button, IconButton } from "../ui/Button.jsx";
import { Icon } from "../ui/Icon.jsx";
import { Mark } from "../ui/Logo.jsx";
import { Tooltip } from "../ui/Tooltip.jsx";
import { CustomizeActions } from "../metadata/CustomizeActions.jsx";
import { useAuth } from "../auth/AuthGate.jsx";

const THEME_KEY = "fount-theme";

const SECTIONS = [
  { id: "how", label: "How it works" },
  { id: "capabilities", label: "What you get" },
  { id: "playground", label: "Try it" },
  { id: "extension", label: "Extension" },
];

function useActiveSection(enabled) {
  const [active, setActive] = useState("");
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver !== "function") {
      setActive("");
      return;
    }
    const nodes = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean);
    if (!nodes.length) return;
    const visible = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          visible.set(entry.target.id, entry.isIntersecting);
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

export function Header() {
  const auth = useAuth();
  const store = useStore();
  const [condensed, setCondensed] = useState(false);
  const [theme, setTheme] = useTheme();
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const dark = theme === "system" ? systemDark : theme === "dark";
  const editing = store.metadata.open;
  const active = useActiveSection(!store.hasResults && !editing);

  const [fieldOnScreen, setFieldOnScreen] = useState(true);
  const frame = useRef(0);
  const headerRef = useRef(null);

  useEffect(() => {
    const node = headerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty("--header-offset", node.offsetHeight + 24 + "px");
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [editing]);

  useEffect(() => {
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
    if (store.metadata.applying) return;
    if (editing && !store.closeMetadata()) return;
    store.clearResults();
    scrollTo({ top: 0, behavior: "instant" });
  };

  const toField = () => {
    const field = document.getElementById("url");
    field?.scrollIntoView({ block: "center" });
    field?.focus();
  };

  let centre = null;
  if (editing) {
    centre = store.metadata.fonts.length ? (
      <nav class="island-nav" aria-label="On this page">
        <a href="#font-details">Details</a>
        <a href="#font-styles">Styles <span class="island-count">{store.metadata.fonts.length}</span></a>
      </nav>
    ) : (
      <span class="island-label">Customize font</span>
    );
  } else if (store.hasResults) {
    centre = <span class="island-label">{store.collectionLabel}</span>;
  } else {
    centre = (
      <nav class="island-nav" aria-label="Sections">
        {SECTIONS.map((section) => (
          <a key={section.id} href={"#" + section.id}
            aria-current={active === section.id ? "true" : undefined}>
            {section.label}
          </a>
        ))}
      </nav>
    );
  }

  let actions = null;
  if (editing) {
    actions = <CustomizeActions />;
  } else if (store.hasResults) {
    actions = <Button variant="outline" size="s" onClick={home}>New scan</Button>;
  } else if (!fieldOnScreen) {
    actions = <Button variant="solid" size="s" iconEnd="arrowRight" onClick={toField}>Scan a site</Button>;
  }

  return (
    <header class="island" ref={headerRef} data-condensed={String(condensed)} data-editor={String(editing)}>
      <div class="island-start">
        {editing ? (
          <Button id="customize-back" variant="quiet" size="s" icon="arrowLeft"
            disabled={store.metadata.applying} onClick={() => store.closeMetadata()}>Back</Button>
        ) : null}
        <a class="wordmark" href="/" onClick={home} aria-label="Fount home">
          <Mark size={26} /><span>Fount</span>
        </a>
      </div>
      {centre}
      <div class="island-end">
        {actions}
        <Tooltip placement="bottom"
          text={dark ? "Switch to the light theme" : "Switch to the dark theme"}>
          <IconButton icon={dark ? "sun" : "moon"} size="s"
            label={dark ? "Switch to the light theme" : "Switch to the dark theme"}
            onClick={() => setTheme(dark ? "light" : "dark")} />
        </Tooltip>
        {!editing ? (
          <a class="island-github" href="https://github.com/Piwqust/font-grabber"
            target="_blank" rel="noopener" aria-label="Fount on GitHub">
            <Icon name="github" size={18} />
          </a>
        ) : null}
        {auth ? <Button size="s" variant="quiet" onClick={auth.logout} busy={auth.busy}>Sign out</Button>
          : <span class="island-badge">{HOSTED ? "Hosted" : "Local"}</span>}
      </div>
    </header>
  );
}
