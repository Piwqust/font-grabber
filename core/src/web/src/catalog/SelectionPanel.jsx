import { useStore, HOSTED } from "../store.jsx";
import { styleLabel } from "../lib/fonts.js";
import { useCountUp } from "../lib/motion.js";
import { Button, IconButton } from "../ui/Button.jsx";
import { Field } from "../ui/Field.jsx";
import { Icon } from "../ui/Icon.jsx";
import { Popover } from "../ui/Popover.jsx";
import { Segmented } from "../ui/Segmented.jsx";
import { CopyButton } from "../ui/CopyButton.jsx";

/**
 * The basket. It lists what is actually going to be exported, so the count in
 * the button is never the only description of the selection.
 */
export function SelectionPanel() {
  const store = useStore();
  const files = store.fonts.filter((font) => store.selectedSet.has(font.id));
  const count = useCountUp(files.length);
  const verb = store.delivery === "folder" ? "Save" : "Download";

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

      <div class="selection-files">
        {files.length ? (
          <ul>
            {files.map((font) => (
              <li class="selection-file" key={font.id}>
                <Icon name="file" size={16} />
                <div class="selection-file-name">
                  <strong>
                    {font.family || "Unnamed font"} {styleLabel(font)}
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
                  label={`Remove ${font.family || "Unnamed font"} ${styleLabel(font)} from selection`}
                  onClick={() => store.toggleFace(font.id, false)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p class="selection-empty">
            Choose a family or an individual face. Your selected files appear
            here.
          </p>
        )}
      </div>

      <div class="selection-actions">
        <Popover
          title="Export settings"
          trigger={
            <Button
              size="s"
              variant="quiet"
              icon="sliders"
              disabled={store.grabbing}
            >
              Export settings
            </Button>
          }
        >
          {HOSTED ? null : (
            <Segmented
              label="Save as"
              size="s"
              options={[
                { value: "zip", label: "ZIP download" },
                { value: "folder", label: "Save to folder" },
              ]}
              value={store.delivery}
              disabled={store.busy}
              onChange={(delivery) => store.patch({ delivery })}
            />
          )}

          {store.delivery === "folder" ? (
            <Field
              label="Folder on the computer running Fount"
              placeholder="Default folder"
              spellcheck={false}
              autocomplete="off"
              value={store.outputDir}
              disabled={store.grabbing}
              hint="Leave blank to use Fount's fonts folder, grouped by website. Your choice is kept in this tab."
              onInput={(event) =>
                store.patch({ outputDir: event.currentTarget.value })
              }
            />
          ) : (
            <p class="popover-note">
              ZIP files go to your browser's download folder. You can change
              that in your browser settings.
            </p>
          )}
        </Popover>

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

        {store.grabStatus ? (
          <p
            class={`status status-${store.grabStatus.kind || "plain"}`}
            role="status"
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

      <div class="selection-licence">
        <h3>A new place for your type.</h3>
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
