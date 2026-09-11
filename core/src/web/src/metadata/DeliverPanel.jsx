import { useStore, HOSTED } from "../store.jsx";
import { Button } from "../ui/Button.jsx";
import { CopyButton } from "../ui/CopyButton.jsx";
import { ExportSettings } from "../catalog/ExportSettings.jsx";
import { ExportReport } from "../catalog/Reports.jsx";
import { effectiveNames, faceLabel } from "./derive.js";

/**
 * What happens when the draft is finished: the same delivery choice and the
 * same per-file report as an export, because it is the same operation with one
 * more step in the middle.
 */
export function DeliverPanel({ issues }) {
  const store = useStore();
  const meta = store.metadata;
  const count = meta.fonts.length;
  const verb = store.delivery === "folder" ? "Save" : "Download";
  const status = meta.status;

  const nameFor = (item) => {
    const font = meta.fonts.find((candidate) => candidate.id === item.id);
    if (!font) return item.family || item.id;
    return `${effectiveNames(meta, font).family} ${faceLabel(meta, font)}`;
  };

  return (
    <section class="metadata-deliver" aria-labelledby="meta-deliver">
      <h2 class="meta-section-title" id="meta-deliver">
        Finish
      </h2>
      <p class="meta-section-note">
        Fount writes the names into copies of the files. The originals on the
        website, or on your computer, are left alone.
      </p>

      {issues.length ? (
        <div class="metadata-issues" role="alert">
          <strong>
            {issues.length} field{issues.length === 1 ? "" : "s"} need
            attention:
          </strong>
          <ul>
            {issues.map((issue) => (
              <li key={issue.key}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div class="metadata-deliver-row">
        <ExportSettings busy={meta.applying} />
        <Button
          id="metadata-apply"
          variant="solid"
          iconEnd="download"
          busy={meta.applying}
          disabled={!count || meta.applying || issues.length > 0}
          onClick={() => store.applyMetadata()}
        >
          {count
            ? `${verb} ${count} file${count === 1 ? "" : "s"}`
            : `${verb} files`}
        </Button>
        {meta.report ? (
          <Button
            variant="outline"
            icon="pencil"
            onClick={store.editMetadataAgain}
          >
            Edit again
          </Button>
        ) : null}
      </div>

      {status ? (
        <p class={`status status-${status.kind || "plain"}`} role="status">
          {status.message}
        </p>
      ) : null}

      {!HOSTED && store.savedFolder ? (
        <CopyButton
          value={store.savedFolder}
          label="Copy folder path"
          successLabel="Folder path copied"
        />
      ) : null}

      <ExportReport
        title="Metadata results"
        report={meta.report}
        nameFor={nameFor}
        onDismiss={store.editMetadataAgain}
        onRetry={store.retryMetadata}
      />
    </section>
  );
}
