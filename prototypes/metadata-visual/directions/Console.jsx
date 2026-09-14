// Direction 1 - Console. A dark, dense working surface: the file table on the
// left, the record editor on the right, everything visible at once. It is for
// someone who renames families often and wants no scrolling between the name
// they type and the files it rewrites.
import { useState } from "preact/hooks";
import { useModel } from "../model.jsx";
import {
  Change,
  FAMILY_GROUPS,
  FaceOverrides,
  FamilyFields,
  FamilyName,
  FamilyTabs,
  Issues,
  LoadFiles,
  ResetDraft,
  SampleControl,
  Specimen,
  StatusLine,
  WriteButton,
  WriteReport,
  fileStem,
  outName,
} from "../parts.jsx";

export function ConsolePage() {
  const model = useModel();
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("names");
  const faces = model.familyFonts;
  const active = faces.find((font) => font.id === selected) || faces[0];

  return (
    <div class="cs">
      <header class="cs-bar">
        <span class="cs-mark">Fount</span>
        <span class="cs-path">
          metadata <b>/</b> {model.group || "no family"}
        </span>
        <span class="cs-count">
          {model.fonts.length} files, {model.changed.length} queued
        </span>
        <div class="cs-bar-actions">
          <LoadFiles class="cs-load" label="Open files" />
          <ResetDraft class="cs-ghost" label="Discard" />
          <WriteButton class="cs-write" />
        </div>
      </header>

      <StatusLine class="cs-status" />
      <FamilyTabs />

      <div class="cs-grid">
        <section class="cs-files" aria-label="Files">
          <div class="cs-files-head">
            <span>Style</span>
            <span>Written file</span>
          </div>
          <ul class="cs-rows">
            {faces.map((font) => {
              const value = model.effective(font);
              const dirty = model.changes(font).length > 0;
              return (
                <li key={font.id}>
                  <button
                    type="button"
                    class="cs-row"
                    data-active={String(font.id === active?.id)}
                    data-dirty={String(dirty)}
                    onClick={() => setSelected(font.id)}
                  >
                    <span class="cs-row-style">
                      <span class="cs-dot" aria-hidden="true" />
                      {value.subfamily}
                    </span>
                    <span class="cs-row-file">
                      <Change
                        before={outName(font, fileStem(font.file))}
                        after={outName(font, value.filename)}
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <SampleControl label="Sample" />
        </section>

        <section class="cs-editor" aria-label="Records">
          <div class="cs-tabs" role="tablist">
            {[
              ["names", "Names"],
              ["face", "Selected face"],
              ...FAMILY_GROUPS.map((group) => [group.id, group.label]),
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                class="cs-tab"
                aria-selected={tab === id ? "true" : "false"}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div class="cs-panel">
            {tab === "names" ? (
              <>
                <FamilyName big />
                <p class="cs-note">
                  Every automatic face follows this name: full, PostScript and
                  file names are rewritten together.
                </p>
                <div class="cs-cascade">
                  {faces.map((font) => (
                    <p key={font.id} class="cs-cascade-row">
                      <span>{model.effective(font).subfamily}</span>
                      <Change
                        before={font.names.full_name || fileStem(font.file)}
                        after={model.effective(font).full_name}
                      />
                    </p>
                  ))}
                </div>
              </>
            ) : null}

            {tab === "face" && active ? (
              <>
                <div class="cs-face-head">
                  <Specimen font={active} text={model.sample} size="2.2rem" />
                  <span class="cs-face-name">
                    {model.effective(active).subfamily}
                  </span>
                </div>
                <FaceOverrides font={active} />
              </>
            ) : null}

            {FAMILY_GROUPS.map((group) =>
              tab === group.id ? (
                <div key={group.id} class="cs-fields">
                  <FamilyFields group={group} />
                </div>
              ) : null,
            )}
          </div>

          <Issues />
          <WriteReport />
        </section>
      </div>
    </div>
  );
}

