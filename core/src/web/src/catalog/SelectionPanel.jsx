import { useState } from "preact/hooks";
import { useStore } from "../store.jsx";
import { familyGroups, familyName, styleLabel } from "../lib/fonts.js";
import { useCountUp } from "../lib/motion.js";
import { Button, IconButton } from "../ui/Button.jsx";
import { Icon } from "../ui/Icon.jsx";
import { CopyButton } from "../ui/CopyButton.jsx";
import { ExportSettings } from "./ExportSettings.jsx";

/** Files listed before the rest fold away, so the download stays in view. */
const LISTED = 3;

/**
 * The basket. It lists what is actually going to be exported, so the count in
 * the button is never the only description of the selection.
 */
export function SelectionPanel() {
  const store = useStore();
  // Listed in the catalogue's own order, family by family.
  const files = familyGroups(
    store.fonts.filter((font) => store.selectedSet.has(font.id)),
  ).flatMap((group) => group.fonts);
  const count = useCountUp(files.length);
  const verb = store.delivery === "folder" ? "Save" : "Download";
  const [showAll, setShowAll] = useState(false);
  const listed = showAll ? files : files.slice(0, LISTED);
  const hidden = files.length - listed.length;

  return (
    <aside class="selection" aria-label="Download selection">
      <div class="selection-head">
        <Icon name="download" size={18} class="selection-mark" />
        <div>
          <strong class="selection-count">
            {files.length
              ? `${count} file${files.length === 1 ? "" : "s"} selected`
              : "Your selection"}
          </strong>
          <span class="selection-note">TTF / OTF</span>
        </div>
      </div>

      {/* The actions come before the list: with a whole family selected the
          list is long, and the download must not be pushed off the screen. */}
      <div class="selection-actions">
        <ExportSettings busy={store.grabbing} />

        <Button
          variant="solid"
          full
          iconEnd="download"
          busy={store.grabbing}
          disabled={!files.length || store.busy}
          onClick={() => store.download(store.selected)}
        >
          {files.length
            ? `${verb} ${files.length} file${files.length === 1 ? "" : "s"}`
            : `${verb} selected`}
        </Button>

        {/* The other thing that can be done with a selection: edit what the
            files say about themselves before taking them anywhere. */}
        <Button
          id="edit-metadata-selection"
          variant="outline"
          full
          icon="type"
          disabled={!files.length || store.busy || store.metadata.inspecting}
          busy={store.metadata.inspecting}
          onClick={store.openMetadataFromSelection}
        >
          Customize font
        </Button>

        {store.grabStatus ? (
          <p
            class={`status status-${store.grabStatus.kind || "plain"}`}
            role={store.grabStatus.kind === "error" ? "alert" : "status"}
          >
            {store.grabStatus.message}
          </p>
        ) : null}

        {store.savedFolder ? (
          <CopyButton
            value={store.savedFolder}
            label="Copy folder path"
            successLabel="Folder path copied"
          />
        ) : null}
      </div>

      <div class="selection-files">
        {files.length ? (
          <ul>
            {listed.map((font) => (
              <li class="selection-file" key={font.id}>
                <Icon name="file" size={16} />
                <div class="selection-file-name">
                  <strong>
                    {familyName(font)} {styleLabel(font)}
                  </strong>
                  <small>
                    {font.variable ? "Variable" : "Static"} ·{" "}
                    {font.sources?.[0]?.format || "Font file"}
                  </small>
                </div>
                <IconButton
                  icon="close"
                  size="s"
                  disabled={store.busy}
                  label={`Remove ${familyName(font)} ${styleLabel(font)} from selection`}
                  onClick={() => store.toggleFace(font.id, false)}
                />
              </li>
            ))}
          </ul>
        ) : null}
        {files.length > LISTED ? (
          <Button
            variant="text"
            size="s"
            class="selection-more"
            aria-expanded={showAll}
            onClick={() => setShowAll((value) => !value)}
          >
            {hidden ? `Show all ${files.length} files` : "Show fewer"}
          </Button>
        ) : null}
        {files.length ? null : (
          <p class="selection-empty">
            Choose a family or an individual face. Your selected files appear
            here.
          </p>
        )}
      </div>

      <div class="selection-licence">
        <h2>A new place for your type.</h2>
        <p>
          Check the font licence on the source website before using downloaded
          files in your projects.
        </p>
        <a
          href="https://github.com/Piwqust/font-grabber#readme"
          target="_blank"
          rel="noopener"
        >
          About font exports
          <Icon name="arrowUpRight" size={13} />
        </a>
      </div>
    </aside>
  );
}
