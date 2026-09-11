import { useEffect, useRef, useState } from "preact/hooks";
import { useStore } from "../store.jsx";
import { Button, IconButton } from "../ui/Button.jsx";
import { Field } from "../ui/Field.jsx";
import { Icon } from "../ui/Icon.jsx";
import { Disclosure } from "../ui/Disclosure.jsx";
import { Tooltip } from "../ui/Tooltip.jsx";

const MODES = [
  {
    value: "auto",
    label: "Auto",
    detail: "Reads the page source first and opens a browser only if it has to.",
  },
  {
    value: "static",
    label: "Quick",
    detail: "Only what the page source declares. Fastest.",
  },
  {
    value: "render",
    label: "Browser",
    detail: "Renders the page to catch fonts loaded by script. Slowest.",
  },
];

/**
 * The address bar. One field, one button. The scan method lives behind a
 * small control inside the field, because on the landing page it is a detail
 * almost nobody changes and it was competing with the field for attention.
 * `compact` is the form once results exist: the same control at a smaller
 * size, with the feedback area still attached.
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
          trailing={<ModeMenu compact={compact} />}
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

      {store.scanning || store.canRetry ? (
        <div class="scan-row">
          {store.scanning ? (
            <Button variant="text" size="s" onClick={store.cancelScan}>
              Stop waiting
            </Button>
          ) : (
            <Button
              variant="text"
              size="s"
              icon="refresh"
              onClick={() => store.runScan()}
            >
              Retry scan
            </Button>
          )}
        </div>
      ) : null}

      <ScanStatus />
    </div>
  );
}

/**
 * The scan method, as a menu that opens from the end of the address field.
 * The trigger shows the current choice by name, so the setting is visible
 * without being a row of its own.
 */
function ModeMenu({ compact }) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const current = MODES.find((m) => m.value === store.mode) || MODES[0];

  useEffect(() => {
    if (!open) return;
    const away = (event) => {
      if (!wrap.current?.contains(event.target)) setOpen(false);
    };
    const key = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        wrap.current?.querySelector("button")?.focus();
      }
    };
    addEventListener("pointerdown", away);
    addEventListener("keydown", key);
    return () => {
      removeEventListener("pointerdown", away);
      removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div class="mode-menu" ref={wrap}>
      <button
        type="button"
        class={`mode-trigger ${compact ? "is-compact" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Scan method: ${current.label}`}
        disabled={store.busy}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{current.label}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open ? (
        <ul class="mode-list" role="listbox" aria-label="Scan method">
          {MODES.map((mode) => (
            <li key={mode.value}>
              <button
                type="button"
                role="option"
                class="mode-option"
                aria-selected={mode.value === store.mode}
                onClick={() => {
                  store.patch({ mode: mode.value });
                  setOpen(false);
                }}
              >
                <span class="mode-option-check">
                  {mode.value === store.mode ? (
                    <Icon name="check" size={14} />
                  ) : null}
                </span>
                <span class="mode-option-text">
                  <span class="mode-option-label">{mode.label}</span>
                  <span class="mode-option-detail">{mode.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
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
