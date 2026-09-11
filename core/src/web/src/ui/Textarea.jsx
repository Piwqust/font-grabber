import { forwardRef } from "preact/compat";
import { useId } from "preact/hooks";

/**
 * A labelled multi-line input. It borrows the Field classes so a form can mix
 * the two without a seam; only the shell changes, because a pill is the wrong
 * shape for three lines of licence text.
 */
export const Textarea = forwardRef(function Textarea(
  {
    label,
    hideLabel = false,
    hint,
    invalid = false,
    rows = 3,
    id,
    class: className = "",
    ...rest
  },
  ref,
) {
  const auto = useId();
  const inputId = id || `field-${auto}`;
  const hintId = hint ? `${inputId}-hint` : undefined;

  return (
    <div
      class={`field field-m ${invalid ? "is-invalid" : ""} ${className}`.trim()}
    >
      <label class={hideLabel ? "sr-only" : "field-label"} for={inputId}>
        {label}
      </label>
      <div class="field-shell is-multiline">
        <textarea
          ref={ref}
          id={inputId}
          class="field-input"
          rows={rows}
          aria-invalid={invalid ? "true" : undefined}
          aria-describedby={
            [hintId, rest["aria-describedby"]].filter(Boolean).join(" ") ||
            undefined
          }
          {...rest}
        />
      </div>
      {hint ? (
        <p class="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
});
