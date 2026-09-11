import { Button } from "../ui/Button.jsx";
import { Icon } from "../ui/Icon.jsx";
import { Reveal } from "../ui/Reveal.jsx";
import { Disclosure } from "../ui/Disclosure.jsx";

const FAQ = [
  {
    q: "Can I use the fonts I download?",
    a: "That depends entirely on the licence attached to the typeface, and Fount cannot read it for you. Check the licence on the source website before using a downloaded file in anything you ship.",
  },
  {
    q: "Why did a scan find nothing?",
    a: "Some sites load type from script after the page settles. Switch the method to Browser so the page is rendered before the fonts are collected. If the fonts are behind a login, the Chrome extension can read them from the page you are already on.",
  },
  {
    q: "What is the difference between Quick and Browser?",
    a: "Quick reads the page source and its stylesheets, which is fast and enough for most sites. Browser renders the page in a real headless browser and collects whatever it actually loads, which is slower but catches dynamic type.",
  },
  {
    q: "Where do the files go?",
    a: "The hosted edition always sends a ZIP to your browser's download folder. The local edition can also write straight to a folder you name, grouped by website.",
  },
];

export function Extension() {
  return (
    <section
      class="section extension"
      id="extension"
      aria-labelledby="extension-title"
    >
      <Reveal class="extension-panel">
        <div class="extension-copy">
          <p class="eyebrow">On the page you are already on</p>
          <h2 class="section-title" id="extension-title">
            The Chrome extension
          </h2>
          <p class="extension-body">
            Some type only exists behind a login, or after an interaction. The
            extension reads the fonts from the tab in front of you and hands
            them over with the same preview, selection and export.
          </p>
          <div class="extension-actions">
            <Button
              as="a"
              variant="solid"
              href="https://github.com/Piwqust/font-grabber/blob/HEAD/extension/README.md#install-load-unpacked"
              target="_blank"
              rel="noopener"
              iconEnd="arrowUpRight"
            >
              Install the extension
            </Button>
            <Button
              as="a"
              variant="text"
              href="https://github.com/Piwqust/font-grabber#readme"
              target="_blank"
              rel="noopener"
              iconEnd="arrowUpRight"
            >
              Read the docs
            </Button>
          </div>
        </div>
        <div class="extension-visual" aria-hidden="true">
          <div class="popup-mock">
            <div class="popup-head">
              <Icon name="puzzle" size={16} />
              <span>Fount</span>
              <span class="popup-count">12 faces</span>
            </div>
            {["Inter", "Söhne", "Newsreader"].map((name, index) => (
              <div
                class="popup-row"
                key={name}
                data-selected={String(index === 1)}
              >
                <span class="popup-box" />
                <span class="popup-name">{name}</span>
                <span class="popup-sample">Aa</span>
              </div>
            ))}
            <div class="popup-foot">
              <span>1 selected</span>
              <span class="popup-cta">
                Download <Icon name="download" size={13} />
              </span>
            </div>
          </div>
        </div>
      </Reveal>

      <div class="faq">
        <Reveal as="h2" class="faq-title">
          Questions worth asking
        </Reveal>
        <div class="faq-list">
          {FAQ.map((item) => (
            <Disclosure key={item.q} summary={item.q}>
              <p>{item.a}</p>
            </Disclosure>
          ))}
        </div>
      </div>
    </section>
  );
}
