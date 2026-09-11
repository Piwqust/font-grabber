import { useStore, HOSTED } from "../store.jsx";
import { Button } from "../ui/Button.jsx";
import { Field } from "../ui/Field.jsx";
import { Popover } from "../ui/Popover.jsx";
import { Segmented } from "../ui/Segmented.jsx";

/**
 * Where the files go: a ZIP the browser downloads, or a folder on the computer
 * running Fount. One panel, shared by the catalogue and the metadata editor,
 * because the choice and its consequences are the same in both places.
 */
export function ExportSettings({ busy = false }) {
  const store = useStore();

  return (
    <Popover
      title="Export settings"
      trigger={
        <Button size="s" variant="quiet" icon="sliders" disabled={busy}>
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
          disabled={busy || store.busy}
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
          disabled={busy}
          hint="Leave blank to use Fount's fonts folder, grouped by website. Your choice is kept in this tab."
          onInput={(event) =>
            store.patch({ outputDir: event.currentTarget.value })
          }
        />
      ) : (
        <p class="popover-note">
          ZIP files go to your browser's download folder. You can change that in
          your browser settings.
        </p>
      )}
    </Popover>
  );
}
