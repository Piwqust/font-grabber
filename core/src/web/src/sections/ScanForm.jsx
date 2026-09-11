import { useEffect, useRef, useState } from "preact/hooks";
import { useStore } from "../store.jsx";
import { Button, IconButton } from "../ui/Button.jsx";
import { Field } from "../ui/Field.jsx";
import { Segmented } from "../ui/Segmented.jsx";
import { Icon } from "../ui/Icon.jsx";
import { Disclosure } from "../ui/Disclosure.jsx";
import { Tooltip } from "../ui/Tooltip.jsx";

const MODES = [
  {
    value: "auto",
    label: "Auto",
    title: "Start with page source; use the browser if needed",
  },
  {
    value: "static",
    label: "Quick",
    title: "Find fonts declared in the page source",
  },
  {
    value: "render",
    label: "Browser",
    title: "Render the page to find dynamically loaded fonts",
  },
];

const EXAMPLES = ["apple.com", "stripe.com", "notion.so", "vercel.com"];

/**
 * The address bar. `compact` is the form once results exist: the same control,
 * without the examples and the explanation that only matter before a scan.
 */
export function ScanForm({ compact = false }) {
  const store = useStore();
  const inputRef = useRef(null);
  const [invalid, setInvalid] = useState(false);

  const submit = (event) => {
    event.preventDefault();
    if (!store.url.trim()) {
      setInvalid(true);
      inputRef.current?.focus();
      return;
    }
    setInvalid(false);
    store.runScan();
  };

  useEffect(() => {
    if (
      store.status?.kind === "error" &&
      store.status.message.startsWith("Enter a website")
    )
      setInvalid(true);
  }, [store.status]);

  return (
    <div class={`scanner ${compact ? "is-compact" : ""}`}>
      <form class="scan-form" onSubmit={submit} aria-busy={store.scanning}>
        <Field
          ref={inputRef}
          label="Website address"
          hideLabel
          icon="link"
          size={compact ? "m" : "l"}
          id="url"
          type="text"
          inputMode="url"
          placeholder="example.com"
          autocomplete="url"
          spellcheck={false}
          invalid={invalid}
          value={store.url}
          disabled={store.busy}
          onInput={(event) => {
            setInvalid(false);
            store.patch({ url: event.currentTarget.value });
          }}
        />
        <Button
          variant="solid"
          size={compact ? "m" : "l"}
          type="submit"
          busy={store.scanning}
          iconEnd={store.scanning ? undefined : "arrowRight"}
          disabled={store.busy}
        >
          {store.scanning ? "Scanning…" : "Find fonts"}
        </Button>
      </form>

      <div class="scan-row">
        <Segmented
          label="Scan method"
          size="s"
          options={MODES}
          value={store.mode}
          disabled={store.busy}
          onChange={(mode) => store.patch({ mode })}
        />
        {store.scanning ? (
          <Button variant="text" size="s" onClick={store.cancelScan}>
            Stop waiting
          </Button>
        ) : store.canRetry ? (
          <Button
            variant="text"
            size="s"
            icon="refresh"
            onClick={() => store.runScan()}
          >
            Retry scan
          </Button>
        ) : null}
      </div>

      {compact ? null : <Examples />}

      <ScanStatus />
    </div>
  );
}

function Examples() {
  const store = useStore();
  return (
    <div class="examples">
      <span class="examples-label">Try an example</span>
      <div class="examples-list">
        {EXAMPLES.map((site) => (
          <Button
            key={site}
            variant="chip"
            size="s"
            disabled={store.busy}
            onClick={() => store.runScan({ url: `https://${site}` })}
          >
            {site}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ScanStatus() {
  const store = useStore();
  const { status, warnings, showExtensionHelp, history } = store;

  return (
    <div class="scan-feedback">
      {status ? (
        <p class={`status status-${status.kind || "plain"}`} role="status">
          {status.message}
        </p>
      ) : null}

      {warnings.length ? (
        <Disclosure
          summary="Warnings"
          meta={`${warnings.length}`}
          tone="warning"
          class="scan-warnings"
        >
          <ul>
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </Disclosure>
      ) : null}

      {showExtensionHelp ? (
        <p class="scan-note">
          Missing fonts?{" "}
          <a
            href="https://github.com/Piwqust/font-grabber/blob/HEAD/extension/README.md#install-load-unpacked"
            target="_blank"
            rel="noopener"
          >
            Use the Chrome extension on the original page
            <Icon name="arrowUpRight" size={14} />
          </a>
        </p>
      ) : null}

      {history.length ? <RecentSites /> : null}
    </div>
  );
}

function RecentSites() {
  const store = useStore();
  return (
    <Disclosure
      summary="Recent websites"
      meta={String(store.history.length)}
      class="recent"
    >
      <ul class="recent-list">
        {store.history.map((entry) => (
          <li key={entry.url} class="recent-row">
            <button
              type="button"
              class="recent-pick"
              disabled={store.busy}
              onClick={() =>
                store.patch({
                  url: entry.url,
                  mode: ["auto", "static", "render"].includes(entry.mode)
                    ? entry.mode
                    : "auto",
                })
              }
            >
              <span class="recent-url">{entry.url}</span>
              <span class="recent-meta">
                {entry.count} faces ·{" "}
                {new Date(entry.time).toLocaleDateString()}
              </span>
            </button>
            <Tooltip text="Remove from history">
              <IconButton
                icon="close"
                size="s"
                label={`Remove ${entry.url} from history`}
                onClick={() => store.forgetSite(entry.url)}
              />
            </Tooltip>
          </li>
        ))}
      </ul>
      <Button variant="text" size="s" onClick={store.clearHistory}>
        Clear history
      </Button>
    </Disclosure>
  );
}
