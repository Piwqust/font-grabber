import { useEffect, useRef } from "preact/hooks";
import { play, spring } from "../lib/motion.js";
import { Icon } from "./Icon.jsx";

/**
 * A checkbox drawn as a filled square. The native input stays in the tree and
 * keeps every keyboard and assistive-technology behaviour; the visual box is a
 * sibling that reacts to it.
 */
export function Checkbox({
  checked = false,
  indeterminate = false,
  onChange,
  label,
  hideLabel = false,
  disabled = false,
  class: className = "",
  ...rest
}) {
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  const wasChecked = useRef(checked);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  useEffect(() => {
    if (checked && !wasChecked.current)
      play(
        boxRef.current,
        { scale: [0.82, 1] },
        { type: spring, duration: 0.3, bounce: 0.35 },
      );
    wasChecked.current = checked;
  }, [checked]);

  return (
    <label
      class={`checkbox ${disabled ? "is-disabled" : ""} ${className}`.trim()}
    >
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.currentTarget.checked, event)}
        {...rest}
      />
      <span class="checkbox-box" ref={boxRef} aria-hidden="true">
        {indeterminate ? (
          <span class="checkbox-dash" />
        ) : (
          <Icon name="check" size={14} />
        )}
      </span>
      <span class={hideLabel ? "sr-only" : "checkbox-label"}>{label}</span>
    </label>
  );
}
