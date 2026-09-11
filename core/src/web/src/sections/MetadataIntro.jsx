import { Button } from "../ui/Button.jsx";
import { Icon } from "../ui/Icon.jsx";

/**
 * The entry point for metadata editing on the landing page. The editor itself
 * is not designed yet; this is the same width and weight as the address bar
 * so the two tasks sit in the same place, and it says plainly what it will do.
 */
export function MetadataIntro() {
  return (
    <div class="metadata-intro" role="group" aria-label="Edit metadata">
      <div class="metadata-drop">
        <Icon name="file" size={22} class="metadata-drop-mark" />
        <span class="metadata-drop-title">Drop a TTF or OTF here</span>
        <span class="metadata-drop-note">
          Family, style, full and PostScript names, then a file that installs
          cleanly.
        </span>
        <Button variant="outline" size="m" icon="file" disabled>
          Choose a file
        </Button>
      </div>
    </div>
  );
}
