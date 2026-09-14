// Direction 3 - Studio. A split screen: a dark stage on the left that always
// shows the selected face at size, and a light panel on the right holding the
// controls in three tabs. Made for picking one face and shaping it precisely.
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

const TABS = [
  { id: "family", label: "Family" },
  { id: "face", label: "Selected face" },
  { id: "records", label: "Records" },
];

export function StudioPage() {
  const model = useModel();
  const faces = model.familyFonts;
  const [activeId, setActiveId] = useState(null);
  const [tab, setTab] = useState("family");
  const font = faces.find((item) => item.id === activeId) || faces[0];
  if (!font) return null;
  const value = model.effective(font);

  return (
    <div class="st">
      <section class="st-stage" aria-label="Preview">
        <header class="st-stage-top">
          <span class="st-mark">Fount</span>
          <span class="st-stage-origin">{model.origin}</span>
        </header>

        <div class="st-stage-body">
          <p class="st-stage-style">{value.subfamily}</p>
          <div class="st-stage-proof">
            <Specimen font={font} text={model.sample} size="clamp(2.6rem,7vw,5.5rem)" />
          </div>
          <dl class="st-stage-names">
            <div>
              <dt>Full name</dt>
              <dd>
                <Change before={font.names.full_name || ""} after={value.full_name} />
              </dd>
            </div>
            <div>
              <dt>PostScript</dt>
              <dd class="is-mono">
                <Change before={font.names.postscript || ""} after={value.postscript} />
              </dd>
            </div>
            <div>
              <dt>File</dt>
              <dd class="is-mono">
                <Change
                  before={outName(font, fileStem(font.file))}
                  after={outName(font, value.filename)}
                />
              </dd>
            </div>
          </dl>
          <SampleControl label="Preview text" />
        </div>

        <div class="st-thumbs" role="tablist" aria-label="Faces">
          {faces.map((item) => {
            const itemValue = model.effective(item);
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                class="st-thumb"
                aria-selected={item.id === font.id ? "true" : "false"}
                data-dirty={String(model.changes(item).length > 0)}
                onClick={() => {
                  setActiveId(item.id);
                  setTab("face");
                }}
              >
                <Specimen font={item} text="Aa" size="1.6rem" />
                <span>{itemValue.subfamily}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section class="st-panel">
        <header class="st-panel-top">
          <div class="st-panel-heads">
            <p class="st-panel-kicker">Editing metadata</p>
            <h1 class="st-panel-title">{value.family || "Unnamed family"}</h1>
          </div>
          <div class="st-panel-actions">
            <LoadFiles class="st-load" label="Load fonts" />
            <ResetDraft class="st-ghost" label="Reset" />
          </div>
        </header>

        <FamilyTabs />

        <nav class="st-tabs" role="tablist" aria-label="Metadata sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              class="st-tab"
              aria-selected={tab === item.id ? "true" : "false"}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div class="st-panel-body">
          {tab === "family" ? (
            <div class="st-block">
              <FamilyName big />
              <p class="st-note">
                Every face without custom names follows this. {faces.length} file
                {faces.length === 1 ? "" : "s"} in this family.
              </p>
              <ul class="st-cascade">
                {faces.map((item) => (
                  <li key={item.id}>
                    <span>{model.effective(item).subfamily}</span>
                    <b class="is-mono">{outName(item, model.effective(item).filename)}</b>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {tab === "face" ? (
            <div class="st-block">
              <FaceOverrides font={font} />
            </div>
          ) : null}

          {tab === "records" ? (
            <div class="st-block st-records">
              {FAMILY_GROUPS.map((group) => (
                <section key={group.id} class="st-record">
                  <h2>{group.label}</h2>
                  <FamilyFields group={group} />
                </section>
              ))}
            </div>
          ) : null}

          <Issues />
          <WriteReport />
        </div>

        <footer class="st-panel-foot">
          <StatusLine class="st-status" />
          <WriteButton class="st-write" />
        </footer>
      </section>
    </div>
  );
}
