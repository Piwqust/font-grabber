import { forwardRef } from "preact/compat";
import { useId } from "preact/hooks";
import { Icon } from "./Icon.jsx";

/**
 * A labelled input. The label is always rendered; `hideLabel` moves it to
 * screen readers only rather than dropping it, so a field never ends up
 * nameless.
 */
export const Field = forwardRef(function Field(
  {
    label,
    hideLabel = false,
    icon,
    size = "m",
    hint,
    invalid = false,
    id,
    class: className = "",
    trailing,
    ...rest
  },
  ref,
) {
  const auto = useId();
  const inputId = id || `field-${auto}`;
  const hintId = hint ? `${inputId}-hint` : undefined;

  return (
    <div
      class={`field field-${size} ${invalid ? "is-invalid" : ""} ${className}`.trim()}
    >
      <label class={hideLabel ? "sr-only" : "field-label"} for={inputId}>
        {label}
      </label>
      <div class="field-shell">
        {icon ? (
          <Icon name={icon} size={size === "l" ? 20 : 18} class="field-icon" />
        ) : null}
        <input
          ref={ref}
          id={inputId}
          class="field-input"
          aria-invalid={invalid ? "true" : undefined}
          aria-describedby={
            [hintId, rest["aria-describedby"]].filter(Boolean).join(" ") ||
            undefined
          }
          {...rest}
        />
        {trailing}
      </div>
      {hint ? (
        <p class="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
});
