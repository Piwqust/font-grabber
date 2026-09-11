import { useStore, HOSTED } from "../store.jsx";
import { Icon } from "../ui/Icon.jsx";

export function Footer() {
  const store = useStore();

  // While a collection is on screen the landing sections are not in the
  // document, so a section link has to bring the landing page back first.
  const toSection = (id) => (event) => {
    if (!store.hasResults) return;
    event.preventDefault();
    store.clearResults();
    requestAnimationFrame(() =>
      document.getElementById(id)?.scrollIntoView({ block: "start" }),
    );
  };

  return (
    <footer class="site-foot">
      <div class="foot-brand">
        <a
          class="foot-wordmark"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            store.clearResults();
            scrollTo({ top: 0, behavior: "instant" });
          }}
        >
          Fount
        </a>
        <p>Find fonts. Fuel ideas.</p>
      </div>

      <nav class="foot-links" aria-label="Elsewhere">
        <a href="#how" onClick={toSection("how")}>
          How it works
        </a>
        <a href="#capabilities" onClick={toSection("capabilities")}>
          What you get
        </a>
        <a href="#playground" onClick={toSection("playground")}>
          Try it
        </a>
        <a
          href="https://github.com/Piwqust/font-grabber/blob/HEAD/extension/README.md#install-load-unpacked"
          target="_blank"
          rel="noopener"
        >
          Chrome extension
          <Icon name="arrowUpRight" size={13} />
        </a>
        <a
          href="https://github.com/Piwqust/font-grabber"
          target="_blank"
          rel="noopener"
        >
          Source
          <Icon name="arrowUpRight" size={13} />
        </a>
      </nav>

      <p class="foot-note">
        <span class="edition">
          {HOSTED ? "Hosted edition" : "Local edition"}
        </span>
        <span>
          Check the font licence on the source website before you ship.
        </span>
      </p>
    </footer>
  );
}
