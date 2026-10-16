import { cloneElement } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";

/** Wait before the first tooltip, so passing over a control does not flash one. */
const OPEN_DELAY = 400;
/** Once one has been read, its neighbours open at once for this long after. */
const WARM_FOR = 300;

let openCount = 0;
let lastClosedAt = 0;
const warm = () => openCount > 0 || performance.now() - lastClosedAt < WARM_FOR;

/**
 * A hover/focus tooltip. `aria-describedby` is put on the trigger itself, so
 * the text is announced rather than being purely decorative. Touch pointers
 * are ignored, which is why a tooltip never carries the only copy of an
 * instruction — it explains a control that is already labelled.
 *
 * The first tooltip waits and fades in; moving along a toolbar after that
 * shows each one immediately and without motion, which is what makes the
 * row feel quick. Keyboard focus is also immediate.
 */
export function Tooltip({ text, placement = "top", children }) {
  const auto = useId();
  const id = `tip-${auto}`;
  const [state, setState] = useState({ open: false, instant: false });
  const timer = useRef(0);
  const isOpen = useRef(false);

  const show = (instant) => {
    clearTimeout(timer.current);
    if (!isOpen.current) openCount += 1;
    isOpen.current = true;
    setState({ open: true, instant });
  };
  const hide = () => {
    clearTimeout(timer.current);
    if (!isOpen.current) return;
    isOpen.current = false;
    openCount = Math.max(0, openCount - 1);
    lastClosedAt = performance.now();
    setState((current) => ({ open: false, instant: current.instant }));
  };

  useEffect(() => () => {
    clearTimeout(timer.current);
    if (isOpen.current) openCount = Math.max(0, openCount - 1);
  }, []);

  useEffect(() => {
    if (!state.open) return;
    const close = (event) => event.key === "Escape" && hide();
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [state.open]);

  const onPointerEnter = (event) => {
    if (event.pointerType === "touch") return;
    if (warm()) return show(true);
    timer.current = setTimeout(() => show(false), OPEN_DELAY);
  };

  return (
    <span
      class="tooltip-wrap"
      onPointerEnter={onPointerEnter}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocusIn={(event) => event.target.matches(":focus-visible") && show(true)}
      onFocusOut={hide}
    >
      {cloneElement(children, { "aria-describedby": id })}
      <span
        class={`tooltip tooltip-${placement}`}
        id={id}
        role="tooltip"
        data-open={String(state.open)}
        data-instant={state.instant ? "true" : undefined}
      >
        {text}
      </span>
    </span>
  );
}
