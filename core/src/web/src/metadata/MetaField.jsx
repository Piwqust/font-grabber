import { Field } from "../ui/Field.jsx";
import { Icon } from "../ui/Icon.jsx";
import { Textarea } from "../ui/Textarea.jsx";
import { IconButton } from "../ui/Button.jsx";

/**
 * One editable name record. Three things are always on screen: what the field
 * will say, what the font said before, and a way back to it. A field that has
 * not been typed into shows the original as its own value, so the form reads
 * as the font rather than as a set of blanks.
 *
 * `value` is `undefined` until the person types: that is what distinguishes
 * "keep what the font had" from "set it to this".
 */
export function MetaField({
  label,
  id,
  value,
  original,
  placeholder = "Not set",
  hint,
  error,
  multiline = false,
  rows = 3,
  mono = false,
  readOnly = false,
  disabled = false,
  onChange,
  onReset,
}) {
  const edited = value !== undefined;
  const Control = multiline ? Textarea : Field;

  return (
    <div class="meta-field" data-edited={String(edited)}>
      <Control
        id={id}
        label={label}
        class={mono ? "is-mono" : ""}
        value={edited ? value : (original ?? "")}
        rows={multiline ? rows : undefined}
        placeholder={placeholder}
        invalid={Boolean(error)}
        readOnly={readOnly || undefined}
        disabled={disabled || undefined}
        spellcheck={false}
        autocomplete="off"
        hint={error || hint}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
      {readOnly ? null : (
        <p class="meta-origin">
          <span class="meta-origin-label">
            Original:{" "}
            <span class="meta-origin-value">
              {original ? original : "not set"}
            </span>
          </span>
          {edited ? (
            <IconButton
              icon="undo"
              size="s"
              variant="quiet"
              class="meta-reset"
              label={`Reset ${label}`}
              onClick={onReset}
            />
          ) : null}
        </p>
      )}
    </div>
  );
}

/**
 * What a record says now and what it will say. The arrow only appears when
 * there is a change, so a list of these reads as the edit rather than as a
 * wall of repeated values.
 */
export function BeforeAfter({ before, after }) {
  return (
    <>
      <span class="metadata-before">{before}</span>
      {after === before ? null : (
        <>
          <Icon name="arrowRight" size={13} class="metadata-arrow" />
          <span class="metadata-after">{after}</span>
        </>
      )}
    </>
  );
}

/** A value the editor derives and does not let the person type into. */
export function DerivedValue({ label, value }) {
  return (
    <div class="meta-derived">
      <span class="meta-derived-label">{label}</span>
      <span class="meta-derived-value">{value || "not set"}</span>
    </div>
  );
}
