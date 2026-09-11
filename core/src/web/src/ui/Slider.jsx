import { useId } from "preact/hooks";

/**
 * A range input whose filled track is driven by a custom property, so the fill
 * matches the thumb in every browser without redrawing the control.
 */
export function Slider({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  suffix = "",
  onInput,
  disabled = false,
  id,
  class: className = "",
}) {
  const auto = useId();
  const inputId = id || `slider-${auto}`;
  const progress = ((value - min) / (max - min)) * 100;

  return (
    <div class={`slider ${className}`.trim()}>
      <label class="slider-label" for={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        class="slider-input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={`--progress:${progress}%`}
        onInput={(event) => onInput?.(Number(event.currentTarget.value), event)}
      />
      <output class="slider-value" for={inputId}>
        {value}
        {suffix}
      </output>
    </div>
  );
}
