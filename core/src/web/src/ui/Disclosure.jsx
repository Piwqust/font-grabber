import { useState, useId } from "preact/hooks";
import { Icon } from "./Icon.jsx";

/** An expandable region with stable layout during its open/close transition. */
export function Disclosure({
  summary, meta, children, open: controlledOpen, onToggle, defaultOpen = false,
  tone = "default", class: className = "",
}) {
  const auto = useId();
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolled;
  const toggle = () => {
    const next = !open;
    if (controlledOpen === undefined) setUncontrolled(next);
    onToggle?.(next);
  };
  return (
    <div class={`disclosure disclosure-${tone} ${open ? "is-open" : ""} ${className}`.trim()}>
      <button type="button" class="disclosure-summary" aria-expanded={open} aria-controls={`disclosure-${auto}`} onClick={toggle}>
        <Icon name="chevronRight" size={16} class="disclosure-chevron" />
        <span class="disclosure-title">{summary}</span>
        {meta ? <span class="disclosure-meta">{meta}</span> : null}
      </button>
      <div class="disclosure-panel" data-open={String(open)}>
        <div class="disclosure-body" id={`disclosure-${auto}`} aria-hidden={!open} inert={!open}>
          {children}
        </div>
      </div>
    </div>
  );
}
