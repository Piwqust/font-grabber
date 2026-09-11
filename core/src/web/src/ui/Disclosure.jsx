import { useEffect, useRef, useState, useId } from "preact/hooks";
import { playAlways, prefersReduced, EASE } from "../lib/motion.js";
import { Icon } from "./Icon.jsx";

/**
 * An expandable region that animates to its measured height rather than to a
 * guess, then releases the height so the content can still reflow afterwards.
 * Collapsed content is removed from the tree, so it is never a hidden tab stop.
 */
export function Disclosure({
  summary,
  meta,
  children,
  open: controlledOpen,
  onToggle,
  defaultOpen = false,
  tone = "default",
  class: className = "",
}) {
  const auto = useId();
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolled;
  const bodyRef = useRef(null);
  const first = useRef(true);

  const toggle = () => {
    const next = !open;
    if (controlledOpen === undefined) setUncontrolled(next);
    onToggle?.(next);
  };

  useEffect(() => {
    const body = bodyRef.current;
    if (first.current) {
      first.current = false;
      return;
    }
    if (!body || !open || prefersReduced()) return;
    const height = body.scrollHeight;
    const control = playAlways(
      body,
      { height: [0, `${height}px`], opacity: [0, 1] },
      { duration: 0.28, ease: EASE },
    );
    Promise.resolve(control)
      .catch(() => {})
      .finally(() => {
        body.style.height = "";
        body.style.opacity = "";
      });
  }, [open]);

  return (
    <div
      class={`disclosure disclosure-${tone} ${open ? "is-open" : ""} ${className}`.trim()}
    >
      <button
        type="button"
        class="disclosure-summary"
        aria-expanded={open}
        aria-controls={`disclosure-${auto}`}
        onClick={toggle}
      >
        <Icon name="chevronRight" size={16} class="disclosure-chevron" />
        <span class="disclosure-title">{summary}</span>
        {meta ? <span class="disclosure-meta">{meta}</span> : null}
      </button>
      {open ? (
        <div class="disclosure-body" id={`disclosure-${auto}`} ref={bodyRef}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
