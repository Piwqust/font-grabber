import { Fragment } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useStore, PAGE_SIZE } from "../store.jsx";
import { hostOf } from "../lib/fonts.js";
import { play, stagger, useMediaQuery, EASE } from "../lib/motion.js";
import { Button } from "../ui/Button.jsx";
import { ScanForm } from "../sections/ScanForm.jsx";
import { Toolbar } from "./Toolbar.jsx";
import { FamilyRow } from "./FamilyRow.jsx";
import { SelectionPanel } from "./SelectionPanel.jsx";
import { CoverageReport, ExportReport } from "./Reports.jsx";

/**
 * The results view. It replaces the landing page rather than sitting under it,
 * so after a scan the page is about one collection and nothing else.
 */
export function Catalog() {
  const store = useStore();
  const listRef = useRef(null);
  const signature = `${store.source}:${store.fonts.length}`;
  const lastSignature = useRef("");

  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    // Only the first screenful cascades; a 40-row stagger would make the
    // last result wait most of a second for no reason.
    play(
      [...(listRef.current?.querySelectorAll(".family") || [])].slice(0, 8),
      { opacity: [0, 1], transform: ["translateY(8px)", "translateY(0px)"] },
      { duration: 0.24, delay: stagger(0.02), ease: EASE },
    );
  }, [signature]);

  const groups = store.groups;
  const visible = groups.slice(0, store.visibleCount);
  // A foundry page often preloads its whole catalogue for menus. The faces
  // the page is about come first; a heading marks where the rest begin.
  const otherFrom = groups.some((group) => group.onPage)
    ? visible.findIndex((group) => !group.onPage)
    : -1;

  // `tabindex="-1"` makes this a valid target for the post-scan focus move in
  // App.jsx without adding the region to the tab order.
  return (
    <main class="catalog" id="results" tabindex="-1">
      <header class="catalog-head">
        <div>
          <p class="eyebrow">Scanned</p>
          <h1 class="catalog-title">
            Fonts on <em>{hostOf(store.source)}</em>
          </h1>
          <p class="catalog-sub">{store.collectionLabel}</p>
        </div>
        <ScanForm compact />
      </header>

      <Toolbar />
      <CoverageReport />
      <ExportReport />

      <div class="catalog-body">
        <div class={`catalog-list layout-${store.layout}`} ref={listRef}>
          {visible.length ? (
            visible.map((group, index) => (
              <Fragment key={group.key}>
                {index === otherFrom ? (
                  <h2 class="catalog-divider">Other fonts this site loads</h2>
                ) : null}
                <FamilyRow group={group} />
              </Fragment>
            ))
          ) : (
            <EmptyState />
          )}

          {groups.length > store.visibleCount ? (
            <Button
              variant="outline"
              icon="chevronDown"
              class="load-more"
              onClick={() =>
                store.patch((current) => ({
                  visibleCount: current.visibleCount + PAGE_SIZE,
                }))
              }
            >
              Show more families ({store.visibleCount} of {groups.length})
            </Button>
          ) : null}
        </div>

        <SelectionPanel />
      </div>

      <MobileSelectionBar />
    </main>
  );
}

/**
 * On narrow screens the selection panel sits below the list, where reading
 * order puts it — so the download action needs to stay reachable without
 * scrolling to the bottom of a long catalogue.
 */
function MobileSelectionBar() {
  const store = useStore();
  const narrow = useMediaQuery("(max-width: 1080px)");
  const count = store.selected.length;
  // While the bar slides away after the selection is cleared, it keeps
  // showing the last count instead of flashing "0 files".
  const shown = useRef(count);
  if (count) shown.current = count;
  if (!narrow) return null;
  const open = count > 0;
  const verb = store.delivery === "folder" ? "Save" : "Download";

  return (
    <div
      class="selection-bar"
      data-open={String(open)}
      aria-hidden={open ? undefined : "true"}
      inert={!open}
    >
      <span class="selection-bar-count">
        {shown.current} file{shown.current === 1 ? "" : "s"}
      </span>
      <Button
        id={open ? "edit-metadata-bar" : undefined}
        variant="quiet"
        size="m"
        icon="type"
        busy={store.metadata.inspecting}
        disabled={store.busy || store.metadata.inspecting}
        onClick={store.openMetadataFromSelection}
      >
        Customize font
      </Button>
      <Button
        variant="solid"
        size="m"
        iconEnd="download"
        busy={store.grabbing}
        disabled={store.busy}
        onClick={() => store.download(store.selected)}
      >
        {verb}
      </Button>
    </div>
  );
}

function EmptyState() {
  const store = useStore();
  const searching = Boolean(store.query.trim());
  const emptySelection = store.selectedOnly && !store.selected.length;

  return (
    <div class="empty">
      <h3>
        {emptySelection ? "Your selection is empty" : "No matching faces"}
      </h3>
      <p>
        {searching
          ? `No faces match “${store.query.trim()}”.`
          : "Choose faces in All families to add them here."}
      </p>
      <Button
        variant="outline"
        onClick={() =>
          store.patch({
            query: "",
            selectedOnly: searching ? store.selectedOnly : false,
            visibleCount: PAGE_SIZE,
          })
        }
      >
        {searching ? "Clear search" : "Show all families"}
      </Button>
    </div>
  );
}
