import { useStore, PAGE_SIZE } from "../store.jsx";
import { DEFAULT_SAMPLE } from "../lib/fonts.js";
import { useMediaQuery } from "../lib/motion.js";
import { Button, IconButton } from "../ui/Button.jsx";
import { Field } from "../ui/Field.jsx";
import { Segmented } from "../ui/Segmented.jsx";
import { Slider } from "../ui/Slider.jsx";
import { Popover } from "../ui/Popover.jsx";
import { Tooltip } from "../ui/Tooltip.jsx";

/**
 * Everything that changes what the list shows, in one bar: what to search for,
 * how the previews are set, which faces are listed, and how they are laid out.
 *
 * The bar is sticky, so on a phone it is competing with the catalogue for the
 * screen. There it keeps the two controls people reach for constantly — the
 * search and All/Selected — and folds the rest into a single popover.
 */
export function Toolbar() {
  const store = useStore();
  const phone = useMediaQuery("(max-width: 640px)");
  const canReset = Boolean(store.sample) || store.previewSize !== 32;

  const search = (
    <Field
      label="Search fonts"
      hideLabel
      icon="search"
      type="search"
      placeholder="Search fonts…"
      autocomplete="off"
      value={store.query}
      class="toolbar-search"
      onInput={(event) =>
        store.patch({
          query: event.currentTarget.value,
          visibleCount: PAGE_SIZE,
        })
      }
    />
  );

  const view = (
    <Segmented
      label="Show fonts"
      size="s"
      class="toolbar-view"
      options={[
        { value: "all", label: phone ? "All" : "All families" },
        { value: "selected", label: "Selected", badge: store.selected.length },
      ]}
      value={store.selectedOnly ? "selected" : "all"}
      onChange={(value) =>
        store.patch({
          selectedOnly: value === "selected",
          visibleCount: PAGE_SIZE,
        })
      }
    />
  );

  const previewControls = (
    <>
      <Field
        label="Preview text"
        value={store.sample}
        maxLength={240}
        placeholder={DEFAULT_SAMPLE}
        autocomplete="off"
        onInput={(event) => store.setSample(event.currentTarget.value)}
      />
      <Slider
        label="Size"
        min={24}
        max={96}
        suffix=" px"
        value={store.previewSize}
        onInput={(previewSize) => store.patch({ previewSize })}
      />
      <Button
        size="s"
        variant="text"
        icon="refresh"
        disabled={!canReset}
        onClick={() => {
          store.setSample("");
          store.patch({ previewSize: 32 });
        }}
      >
        Reset text and size
      </Button>
    </>
  );

  const layout = (
    <div class="toolbar-layout">
      <Tooltip text="List layout">
        <IconButton
          icon="list"
          size="s"
          label="List layout"
          variant={store.layout === "list" ? "outline" : "quiet"}
          aria-pressed={store.layout === "list"}
          onClick={() => store.setLayout("list")}
        />
      </Tooltip>
      <Tooltip text="Grid layout">
        <IconButton
          icon="grid"
          size="s"
          label="Grid layout"
          variant={store.layout === "grid" ? "outline" : "quiet"}
          aria-pressed={store.layout === "grid"}
          onClick={() => store.setLayout("grid")}
        />
      </Tooltip>
    </div>
  );

  const actions = (
    <>
      <Button
        size="s"
        variant="text"
        disabled={
          store.busy ||
          !store.filtered.some((font) => !store.selectedSet.has(font.id))
        }
        onClick={store.selectAllMatches}
      >
        Select all matches
      </Button>

      <Button
        size="s"
        variant="text"
        disabled={store.busy || !store.selected.length}
        onClick={store.clearSelection}
      >
        Clear selection
      </Button>

      <Button
        size="s"
        variant="text"
        icon="shield"
        disabled={
          store.busy ||
          !store.selected.length ||
          !store.sample.trim() ||
          store.coverage?.checking
        }
        onClick={store.checkCoverage}
      >
        Check selected text
      </Button>

      {store.undoIds.length && !store.selected.length ? (
        <Button
          size="s"
          variant="outline"
          icon="refresh"
          onClick={store.undoClear}
        >
          Selection cleared · Undo
        </Button>
      ) : null}
    </>
  );

  const count = (
    <span class="toolbar-count" role="status">
      {store.query || store.selectedOnly
        ? store.filteredLabel
        : store.collectionLabel}
    </span>
  );

  if (phone)
    return (
      <div class="toolbar is-compact">
        <div class="toolbar-row">
          {search}
          {view}
          <Popover
            title="Catalogue options"
            trigger={
              <Button size="s" variant="outline" icon="sliders">
                More
              </Button>
            }
          >
            {previewControls}
            <div class="popover-rule" />
            {layout}
            {actions}
          </Popover>
        </div>
        {count}
      </div>
    );

  return (
    <div class="toolbar">
      <div class="toolbar-row">
        {search}
        {view}
        <Popover
          title="Preview settings"
          trigger={
            <Button size="s" variant="outline" icon="sliders">
              Preview
            </Button>
          }
        >
          {previewControls}
        </Popover>
        {layout}
      </div>

      <div class="toolbar-row toolbar-actions">
        {count}
        {actions}
      </div>
    </div>
  );
}
