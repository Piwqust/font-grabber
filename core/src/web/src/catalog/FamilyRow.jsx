import { useStore } from "../store.jsx";
import { faceStyle, faceWeight, familyKey } from "../lib/fonts.js";
import { Button } from "../ui/Button.jsx";
import { Checkbox } from "../ui/Checkbox.jsx";
import { Icon } from "../ui/Icon.jsx";
import { FaceCard } from "./FaceCard.jsx";
import { Preview } from "./Preview.jsx";

const FACES_PER_FAMILY = 40;

/**
 * A family: collapsed it is one row with a preview set in the family's own
 * type; expanded it lists every matching face. The header checkbox reflects
 * the *matching* faces, so it never claims to have selected something the
 * current search has hidden.
 */
export function FamilyRow({ group }) {
  const store = useStore();
  const open = store.expandedSet.has(group.key);

  const allFaces = store.fonts.filter((font) => familyKey(font) === group.key);
  const selectedCount = group.fonts.filter((font) =>
    store.selectedSet.has(font.id),
  ).length;
  const all = selectedCount > 0 && selectedCount === group.fonts.length;
  const some = selectedCount > 0 && !all;
  const hasVariable = group.fonts.some((font) => font.variable);
  const limit = store.familyLimits[group.key] || FACES_PER_FAMILY;
  const shown = group.fonts.slice(0, limit);

  const representative =
    group.fonts.find(
      (font) => faceWeight(font) === 400 && faceStyle(font) === "normal",
    ) || group.fonts[0];

  const deliveryVerb = store.delivery === "folder" ? "Save" : "Download";

  return (
    <section
      class="family"
      data-open={String(open)}
      data-selected={String(selectedCount > 0)}
    >
      <div class="family-head">
        <Checkbox
          checked={all}
          indeterminate={some}
          disabled={store.busy}
          label={`Select matching faces in ${group.name}`}
          hideLabel
          onChange={(next) => store.toggleFamily(group.key, next)}
        />

        <button
          type="button"
          class="family-toggle"
          aria-expanded={open}
          onClick={() => store.toggleExpanded(group.key)}
        >
          <Icon name="chevronRight" size={16} class="family-chevron" />
          <span class="family-name">{group.name}</span>
          <span class="family-meta">
            {group.fonts.length} {group.fonts.length === 1 ? "face" : "faces"}
            {group.fonts.length !== allFaces.length
              ? ` of ${allFaces.length}`
              : ""}
            {selectedCount ? ` · ${selectedCount} selected` : ""}
          </span>
          {group.onPage ? <span class="family-badge">On this page</span> : null}
        </button>

        <Button
          size="s"
          variant="quiet"
          icon="download"
          disabled={store.busy}
          class="family-download"
          onClick={() => store.download(allFaces.map((font) => font.id))}
          aria-label={`${deliveryVerb} all ${allFaces.length} files in ${group.name}`}
        >
          {deliveryVerb} family ({allFaces.length})
        </Button>
      </div>

      <div class="family-content" data-open={String(open)}>
        <div class="family-preview-panel" inert={open}>
          <button
            type="button"
            class="family-strip"
            onClick={() => store.toggleExpanded(group.key)}
            aria-label={"Show the " + group.fonts.length + " faces in " + group.name}
          >
            <Preview font={representative} text={store.sampleText} />
          </button>
        </div>
        <div class="family-faces-panel" inert={!open}>
          <div class="family-faces">
          {hasVariable ? (
            <Button
              size="s"
              variant="text"
              disabled={store.busy}
              onClick={() => store.selectVariableOnly(group.key)}
            >
              Select only variable matches
            </Button>
          ) : null}

          <div class="face-list">
            {shown.map((font) => (
              <FaceCard key={font.id} font={font} />
            ))}
          </div>

          {group.fonts.length > limit ? (
            <Button
              size="s"
              variant="outline"
              icon="chevronDown"
              onClick={() => store.showMoreFaces(group.key)}
            >
              Show more faces ({limit} of {group.fonts.length})
            </Button>
          ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
