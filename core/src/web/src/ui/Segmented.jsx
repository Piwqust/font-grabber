import { useActiveClip } from "../lib/motion.js";

/**
 * A segmented control. The active state is a second copy of the options,
 * drawn active and clipped to the chosen one; the clip slides between
 * options, so the highlight travels instead of blinking from place to place.
 *
 * @param {{value:string,label:any,title?:string,badge?:any}[]} options
 */
export function Segmented({
  options,
  value,
  onChange,
  label,
  size = "m",
  disabled = false,
  class: className = "",
}) {
  const { groupRef, clipRef } = useActiveClip(value);

  const onKeyDown = (event) => {
    const index = options.findIndex((option) => option.value === value);
    const delta =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = options[(index + delta + options.length) % options.length];
    onChange(next.value);
    groupRef.current
      ?.querySelector(`[data-value="${CSS.escape(next.value)}"]`)
      ?.focus();
  };

  return (
    <div
      class={`segmented segmented-${size} ${className}`.trim()}
      role="group"
      aria-label={label}
      ref={groupRef}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          class="segmented-option"
          data-value={option.value}
          data-active={String(option.value === value)}
          aria-pressed={option.value === value}
          title={option.title}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.badge != null ? (
            <span class="segmented-badge">{option.badge}</span>
          ) : null}
        </button>
      ))}
      <span class="segmented-active" aria-hidden="true">
        <span class="segmented-active-layer" ref={clipRef}>
          {options.map((option) => (
            <span key={option.value} class="segmented-option">
              {option.label}
              {option.badge != null ? (
                <span class="segmented-badge">{option.badge}</span>
              ) : null}
            </span>
          ))}
        </span>
      </span>
    </div>
  );
}
