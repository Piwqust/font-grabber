import { useStore } from "../store.jsx";
import { Preview } from "../catalog/Preview.jsx";
import { Icon } from "../ui/Icon.jsx";
import { BeforeAfter } from "./MetaField.jsx";
import {
  effectiveNames,
  faceDiffers,
  faceLabel,
  fileStem,
  sourceName,
} from "./derive.js";

/**
 * The files being edited, each set in its own type. The list is also the
 * answer to "what is actually going to change": every face that the draft
 * touches is marked, and says what its names will be afterwards.
 */
export function FaceList() {
  const store = useStore();
  const meta = store.metadata;
  const changing = meta.fonts.filter((font) => faceDiffers(meta, font)).length;

  return (
    <aside class="metadata-faces" aria-label="Files being edited">
      <div class="metadata-faces-head">
        <Icon name="file" size={18} class="metadata-faces-mark" />
        <div>
          <strong class="metadata-faces-count">
            {meta.fonts.length} file{meta.fonts.length === 1 ? "" : "s"}
          </strong>
          <span class="metadata-faces-note">
            {changing
              ? `${changing} will change`
              : "No changes to write yet"}
          </span>
        </div>
      </div>

      <ul class="metadata-face-list">
        {meta.fonts.map((font) => (
          <FaceRow key={font.id} font={font} />
        ))}
      </ul>

      {meta.failures.length ? (
        <div class="metadata-failures">
          <h3>Could not be read</h3>
          <ul>
            {meta.failures.map((failure) => (
              <li key={failure.id}>
                <span class="metadata-failure-name">
                  {failure.file || failure.id}
                </span>
                <span class="metadata-failure-why">{failure.error}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}

function FaceRow({ font }) {
  const store = useStore();
  const meta = store.metadata;
  const preview = meta.previews[font.id];
  const effective = effectiveNames(meta, font);
  const differs = faceDiffers(meta, font);
  const before = sourceName(font, "full_name") || fileStem(font.file);
  const stem = fileStem(font.file);

  return (
    <li class="metadata-face" data-differs={String(differs)}>
      <div class="metadata-face-head">
        <span class="metadata-face-style">{faceLabel(meta, font)}</span>
        {differs ? (
          <span class="metadata-face-flag">
            <span class="metadata-face-dot" aria-hidden="true" />
            Edited
          </span>
        ) : null}
      </div>

      {preview ? (
        <Preview font={preview} text={effective.family || before} />
      ) : (
        <p class="preview is-failed">{effective.family || before}</p>
      )}

      <dl class="metadata-face-change">
        <div>
          <dt>Full name</dt>
          <dd>
            <BeforeAfter before={before} after={effective.full_name} />
          </dd>
        </div>
        <div>
          <dt>File name</dt>
          <dd>
            <BeforeAfter before={stem} after={effective.filename} />
          </dd>
        </div>
      </dl>
    </li>
  );
}
