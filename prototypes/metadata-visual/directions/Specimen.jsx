// Direction 2 - Specimen. A light editorial page where the fonts are the
// largest thing on screen. The family name is typed straight into the headline,
// and each face is a wide row that reads as a proof sheet rather than a form.
import { useState } from "preact/hooks";
import { useModel } from "../model.jsx";
import {
  Change,
  FAMILY_GROUPS,
  FaceOverrides,
  FamilyFields,
  FamilyTabs,
  Issues,
  LoadFiles,
  ResetDraft,
  SampleControl,
  Specimen as Proof,
  StatusLine,
  WriteButton,
  WriteReport,
  fileStem,
  outName,
} from "../parts.jsx";

export function SpecimenPage() {
  const model = useModel();
  const field = model.shared("family");
  const [open, setOpen] = useState(null);
  const faces = model.familyFonts;

  return (
    <div class="sp">
      <header class="sp-top">
        <span class="sp-mark">Fount</span>
        <span class="sp-origin">{model.origin}</span>
        <div class="sp-top-actions">
          <LoadFiles class="sp-load" label="Load fonts" />
          <ResetDraft class="sp-ghost" label="Reset" />
        </div>
      </header>

      <FamilyTabs />

      <section class="sp-hero">
        <p class="sp-kicker">Family name</p>
        <input
          class="sp-title-input"
          value={field.value}
          placeholder={field.mixed ? "Several names" : "Name this family"}
          aria-label="Family name"
          spellcheck={false}
          onInput={(event) => model.setFamily("family", event.currentTarget.value)}
        />
        <div class="sp-hero-foot">
          <p class="sp-hero-meta">
            {faces.length} face{faces.length === 1 ? "" : "s"}
            {field.edited ? (
              <>
                {" / "}
                <button
                  type="button"
                  class="sp-undo"
                  onClick={() => model.resetFamily("family")}
                >
                  back to {field.original || "not set"}
                </button>
              </>
            ) : null}
          </p>
          {model.familyIssue("family") ? (
            <p class="sp-hero-error">{model.familyIssue("family")}</p>
          ) : null}
          <SampleControl label="Proof text" />
        </div>
      </section>

      <section class="sp-proofs" aria-label="Faces">
        {faces.map((font) => {
          const value = model.effective(font);
          const dirty = model.changes(font).length > 0;
          const expanded = open === font.id;
          return (
            <article key={font.id} class="sp-proof" data-dirty={String(dirty)}>
              <div class="sp-proof-line">
                <Proof font={font} text={model.sample} size="clamp(2rem,5.4vw,4.2rem)" />
              </div>
              <div class="sp-proof-meta">
                <span class="sp-proof-style">{value.subfamily}</span>
                <span class="sp-proof-file">
                  <Change
                    before={outName(font, fileStem(font.file))}
                    after={outName(font, value.filename)}
                  />
                </span>
                <button
                  type="button"
                  class="sp-proof-toggle"
                  aria-expanded={expanded ? "true" : "false"}
                  onClick={() => setOpen(expanded ? null : font.id)}
                >
                  {expanded ? "Close" : "Names"}
                </button>
              </div>
              {expanded ? (
                <div class="sp-proof-body">
                  <FaceOverrides font={font} />
                </div>
              ) : null}
            </article>
          );
        })}
      </section>

      <section class="sp-records" aria-label="Family records">
        {FAMILY_GROUPS.map((group) => (
          <details key={group.id} class="sp-record">
            <summary>
              <span>{group.label}</span>
              <small>{model.shared(group.fields[0][0]).value || "Not set"}</small>
            </summary>
            <div class="sp-record-body">
              <FamilyFields group={group} />
            </div>
          </details>
        ))}
      </section>

      <Issues />
      <WriteReport />

      <footer class="sp-foot">
        <StatusLine class="sp-status" />
        <WriteButton class="sp-write" />
      </footer>
    </div>
  );
}
