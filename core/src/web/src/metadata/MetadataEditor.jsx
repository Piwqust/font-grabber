import { useEffect, useMemo } from "preact/hooks";
import { useStore } from "../store.jsx";
import { hostOf } from "../lib/fonts.js";
import { Spinner } from "../ui/Spinner.jsx";
import { MetadataIntro } from "../sections/MetadataIntro.jsx";
import { FaceList } from "./FaceList.jsx";
import { MetadataForm } from "./MetadataForm.jsx";
import { DeliverPanel } from "./DeliverPanel.jsx";
import { draftIssues, effectiveNames } from "./derive.js";

/**
 * The third screen. It replaces the landing page or the catalogue rather than
 * sitting inside either, because renaming a family is a task of its own and
 * the page should be about nothing else while it is happening.
 */
export function MetadataEditor() {
  const store = useStore();
  const meta = store.metadata;

  const issues = useMemo(
    () => draftIssues(meta),
    [meta.fonts, meta.familyDraft, meta.faceDrafts],
  );

  // Focus follows the screen, or a keyboard user is left at the top of a page
  // whose content has been replaced.
  useEffect(() => {
    document.getElementById("metadata")?.focus({ preventScroll: true });
    scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const first = meta.fonts[0];
  const family = first ? effectiveNames(meta, first).family : "";
  const source = meta.source;
  const where =
    source?.kind === "upload"
      ? `${(source.files || []).length || meta.fonts.length} file${
          ((source.files || []).length || meta.fonts.length) === 1 ? "" : "s"
        } from your computer`
      : source?.url
        ? `From ${hostOf(source.url)}`
        : "";

  return (
    <main class="metadata" id="metadata" tabindex="-1">
      <header class="metadata-head">
        <p class="eyebrow">Editing metadata</p>
        <h1 class="metadata-title">
          {family ? family : "Font metadata"}
          {meta.fonts.length > 1 ? (
            <span class="metadata-title-count">
              {" "}
              and {meta.fonts.length - 1} more face
              {meta.fonts.length === 2 ? "" : "s"}
            </span>
          ) : null}
        </h1>
        <p class="metadata-sub">{where}</p>
      </header>

      {meta.inspecting ? (
        <p class="metadata-loading" role="status">
          <Spinner size={18} />
          {meta.status?.message || "Reading the names in these files…"}
        </p>
      ) : meta.fonts.length ? (
        <div class="metadata-body">
          <FaceList />
          <MetadataForm issues={issues} />
          <DeliverPanel issues={issues} />
        </div>
      ) : (
        <EmptyEditor />
      )}
    </main>
  );
}

/** Nothing to edit: either the first visit, or every file failed to be read. */
function EmptyEditor() {
  const store = useStore();
  const meta = store.metadata;

  return (
    <div class="metadata-empty">
      {meta.status ? (
        <p
          class={`status status-${meta.status.kind || "plain"}`}
          role={meta.status.kind === "error" ? "alert" : "status"}
        >
          {meta.status.message}
        </p>
      ) : null}
      {meta.failures.length ? (
        <ul class="metadata-empty-failures">
          {meta.failures.map((failure) => (
            <li key={failure.id}>
              <span class="metadata-failure-name">
                {failure.file || failure.id}
              </span>
              <span class="metadata-failure-why">{failure.error}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <MetadataIntro />
    </div>
  );
}
