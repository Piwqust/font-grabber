import { useStore } from "../store.jsx";
import { styleLabel } from "../lib/fonts.js";
import { Button, IconButton } from "../ui/Button.jsx";
import { Disclosure } from "../ui/Disclosure.jsx";

/**
 * What the server actually managed to export, including what it could not.
 *
 * Called without props it reports the catalogue export from the store. The
 * metadata editor passes its own report, names and actions, because the shape
 * of the result is the same and there is no reason for a second component.
 */
export function ExportReport({
  title = "Export results",
  report: given,
  nameFor,
  onDismiss,
  onRetry,
}) {
  const store = useStore();
  const report = given === undefined ? store.exportReport : given;
  if (!report) return null;

  const failed = report.results.filter((item) => item.status === "error");
  const verb = report.delivery === "folder" ? "saved" : "prepared";
  const name =
    nameFor ||
    ((item) => {
      const font = store.fonts.find((f) => f.id === item.id);
      return `${item.family || ""} ${font ? styleLabel(font) : ""}`;
    });

  return (
    <section class="report" aria-label={title}>
      <div class="report-head">
        <h3>{title}</h3>
        <p role="status">
          {report.saved_count} of {report.requested_count} files {verb}.
        </p>
        <IconButton
          icon="close"
          size="s"
          label={`Dismiss ${title.toLowerCase()}`}
          onClick={onDismiss || (() => store.patch({ exportReport: null }))}
        />
      </div>

      <Disclosure
        summary="File details"
        defaultOpen={failed.length > 0}
        class="report-details"
      >
        <ul class="report-list">
          {report.results.map((item) => (
            <li key={item.id} class={item.status === "error" ? "is-error" : ""}>
              <span class="report-name">{name(item)}</span>
              <span class="report-outcome">
                {item.error ? `${item.stage}: ${item.error}` : item.file}
              </span>
            </li>
          ))}
          {(report.warnings || []).map((warning, index) => (
            <li key={`w${index}`}>
              <span class="report-outcome">{warning}</span>
            </li>
          ))}
        </ul>
      </Disclosure>

      {failed.length ? (
        <Button
          size="s"
          variant="outline"
          icon="refresh"
          disabled={store.busy || store.metadata.applying}
          onClick={onRetry || store.retryFailed}
        >
          Retry {failed.length} failed file{failed.length === 1 ? "" : "s"}
        </Button>
      ) : null}
    </section>
  );
}

/** Which of the characters in the preview text are missing from each file. */
export function CoverageReport() {
  const store = useStore();
  const coverage = store.coverage;
  if (!coverage) return null;

  return (
    <section class="report" aria-label="Character coverage">
      <div class="report-head">
        <h3>Character coverage</h3>
        <p role="status">{coverage.status}</p>
        <IconButton
          icon="close"
          size="s"
          label="Dismiss coverage results"
          onClick={store.dismissCoverage}
        />
      </div>

      <ul class="report-list">
        {coverage.items.map((item) => {
          const font = store.fonts.find((f) => f.id === item.id);
          return (
            <li key={item.id} class={item.failed ? "is-error" : ""}>
              <span class="report-name">
                {font?.family || "Font"} {font ? styleLabel(font) : ""}
              </span>
              <span class="report-outcome">{item.problem}</span>
            </li>
          );
        })}
      </ul>

      <p class="report-note">
        Checks the characters present in each file, not shaping or layout.
        Change the text in Preview settings.
      </p>
    </section>
  );
}
