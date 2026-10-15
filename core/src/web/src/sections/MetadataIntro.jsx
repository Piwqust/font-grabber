import { useState } from "preact/hooks";
import { useStore, FONT_FILE_TYPES } from "../store.jsx";
import { Icon } from "../ui/Icon.jsx";

/**
 * The entry point for metadata editing on the landing page, and the way back
 * in when the editor has nothing to show.
 *
 * The file input is the control itself rather than a button that stands in for
 * one: that keeps the platform dialogue, its keyboard behaviour and the names
 * of the chosen files. The dashed area around it is a bigger target for a
 * pointer and a drop zone for a drag, and does nothing the input cannot.
 */
export function MetadataIntro() {
  const store = useStore();
  const [dragging, setDragging] = useState(false);
  const busy = store.metadata.inspecting;

  const take = (files) => {
    if (files && files.length) store.openMetadataFromFiles(files);
  };

  return (
    <div class="metadata-intro" role="group" aria-label="Customize font">
      <div
        class="metadata-drop"
        data-dragging={String(dragging)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          take(event.dataTransfer?.files);
        }}
      >
        <Icon name="upload" size={22} class="metadata-drop-mark" />
        <span class="metadata-drop-title">
          {dragging ? "Drop the files to edit them" : "Drop font files here"}
        </span>
        <span class="metadata-drop-note">
          TTF, OTF, WOFF or WOFF2. Your original files stay unchanged.
        </span>

        <div class="metadata-drop-field">
          <label class="sr-only" for="metadata-files">
            Font files to edit
          </label>
          <input
            id="metadata-files"
            class="metadata-drop-input"
            type="file"
            multiple
            accept={FONT_FILE_TYPES}
            disabled={busy}
            onChange={(event) => {
              take(event.currentTarget.files);
              // Cleared so choosing the same file twice fires a change again.
              event.currentTarget.value = "";
            }}
          />
        </div>
      </div>
    </div>
  );
}
