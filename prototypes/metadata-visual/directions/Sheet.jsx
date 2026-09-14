// Direction 4 - Sheet. The whole edit as one table: faces are rows, name
// records are columns, and the diff is read across the row. Built for someone
// renaming a large family who wants to see every resulting file at once.
import { useState } from "preact/hooks";
import { useModel } from "../model.jsx";
import {
  Change,
  FAMILY_GROUPS,
  FamilyFields,
  FamilyName,
  FamilyTabs,
  Issues,
  LoadFiles,
  ResetDraft,
  Specimen,
  StatusLine,
  TextInput,
  WriteButton,
  WriteReport,
  fileStem,
  outName,
} from "../parts.jsx";

export function SheetPage() {
  const model = useModel();
  const faces = model.familyFonts;
  const [openRecords, setOpenRecords] = useState(false);
  const dirty = faces.filter((font) => model.changes(font).length).length;

  return (
    <div class="sh">
      <header class="sh-top">
        <div class="sh-top-left">
          <span class="sh-mark">Fount</span>
          <span class="sh-top-sep" aria-hidden="true">
            /
          </span>
          <span class="sh-top-context">Metadata sheet</span>
        </div>
        <div class="sh-top-right">
          <LoadFiles class="sh-load" label="Load fonts" />
          <ResetDraft class="sh-ghost" label="Reset draft" />
        </div>
      </header>

      <div class="sh-head">
        <div class="sh-head-family">
          <FamilyName label="Family name for every row" big />
        </div>
        <dl class="sh-counters">
          <div>
            <dt>Rows</dt>
            <dd>{faces.length}</dd>
          </div>
          <div>
            <dt>Changing</dt>
            <dd data-dirty={String(dirty > 0)}>{dirty}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{model.origin}</dd>
          </div>
        </dl>
      </div>

      <FamilyTabs />

      <div class="sh-table-wrap">
        <table class="sh-table">
          <caption class="sh-caption">
            One row per file. Cells you type into stop following the family name.
          </caption>
          <thead>
            <tr>
              <th scope="col" class="sh-col-face">
                Face
              </th>
              <th scope="col">Style</th>
              <th scope="col">Full name</th>
              <th scope="col">PostScript</th>
              <th scope="col">Output file</th>
            </tr>
          </thead>
          <tbody>
            {faces.map((font) => (
              <SheetRow key={font.id} font={font} />
            ))}
          </tbody>
        </table>
      </div>

      <section class="sh-records">
        <button
          type="button"
          class="sh-records-toggle"
          aria-expanded={openRecords ? "true" : "false"}
          onClick={() => setOpenRecords((old) => !old)}
        >
          <span>Family records</span>
          <small>Author, licence, version and description apply to all rows</small>
          <b aria-hidden="true">{openRecords ? "-" : "+"}</b>
        </button>
        {openRecords ? (
          <div class="sh-records-body">
            {FAMILY_GROUPS.map((group) => (
              <section key={group.id} class="sh-record">
                <h2>{group.label}</h2>
                <FamilyFields group={group} />
              </section>
            ))}
          </div>
        ) : null}
      </section>

      <Issues />
      <WriteReport />

      <footer class="sh-foot">
        <StatusLine class="sh-status" />
        <WriteButton class="sh-write" />
      </footer>
    </div>
  );
}

/** One file. Every cell is editable; typing in one takes it off the cascade. */
function SheetRow({ font }) {
  const model = useModel();
  const value = model.effective(font);
  const manual = model.isManual(font);
  const dirty = model.changes(font).length > 0;

  const cell = (key, label, mono = false) => (
    <td>
      <TextInput
        class="sh-cell"
        label={label}
        value={value[key]}
        mono={mono}
        error={model.issueFor(font, key)}
        onInput={(next) => model.setFace(font.id, key, next)}
      />
    </td>
  );

  return (
    <>
      <tr class="sh-row" data-dirty={String(dirty)} data-manual={String(manual)}>
        <th scope="row" class="sh-row-face">
          <Specimen font={font} text={value.subfamily || "Aa"} size="1.25rem" />
          <small class="is-mono">{font.file}</small>
        </th>
        {cell("subfamily", "Style name")}
        {cell("full_name", "Full name")}
        {cell("postscript", "PostScript name", true)}
        {cell("filename", "File name", true)}
      </tr>
      <tr class="sh-diff" data-dirty={String(dirty)}>
        <td />
        <td colspan="4">
          <span class="sh-diff-line">
            <Change
              before={font.names.full_name || fileStem(font.file)}
              after={value.full_name}
            />
          </span>
          <span class="sh-diff-line is-mono">
            <Change
              before={outName(font, fileStem(font.file))}
              after={outName(font, value.filename)}
            />
          </span>
          {manual ? (
            <button
              type="button"
              class="sh-diff-reset"
              onClick={() => model.resetFace(font.id)}
            >
              Follow the family name again
            </button>
          ) : null}
        </td>
      </tr>
    </>
  );
}
