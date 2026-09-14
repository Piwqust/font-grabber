import { cloneElement } from "preact";
import { useEffect, useId, useState } from "preact/hooks";
import { useFloating } from "../lib/floating.js";
import { IconButton } from "./Button.jsx";

/**
 * A panel anchored to a trigger, built on the native popover API so light
 * dismiss, Escape and the top layer come from the platform. Placement comes
 * from Floating UI, which flips and shifts the panel to keep it on screen,
 * and keeps following the anchor while the panel is open.
 *
 * `trigger` is a single element; it receives the wiring it needs.
 */
export function Popover({
  trigger,
  title,
  children,
  placement = "bottom-end",
}) {
  const auto = useId();
  const id = `popover-${auto}`;
  const [open, setOpen] = useState(false);
  const { anchorRef, floatingRef, startAutoUpdate, stopAutoUpdate } =
    useFloating({ placement, strategy: "fixed" });

  useEffect(() => {
    const panel = floatingRef.current;
    if (!panel) return;
    const onToggle = (event) => {
      const isOpen = event.newState === "open";
      setOpen(isOpen);
      if (isOpen) {
        // A tall panel is capped before measuring, so the flip decision is
        // made against the height the panel will actually have.
        panel.style.maxHeight = `${Math.max(120, innerHeight - 32)}px`;
        startAutoUpdate();
        // Focus the first control so the panel is usable from the keyboard.
        panel.querySelector("input, select, button, [tabindex]")?.focus();
      } else {
        stopAutoUpdate();
        if (
          panel.contains(document.activeElement) ||
          document.activeElement === document.body
        )
          anchorRef.current?.focus({ preventScroll: true });
      }
    };
    panel.addEventListener("toggle", onToggle);
    return () => panel.removeEventListener("toggle", onToggle);
  }, [startAutoUpdate, stopAutoUpdate]);

  return (
    <>
      {cloneElement(trigger, {
        ref: anchorRef,
        popovertarget: id,
        "aria-expanded": open,
      })}
      <div class="popover" id={id} popover="auto" ref={floatingRef}>
        <div class="popover-head">
          <h2 class="popover-title">{title}</h2>
          <IconButton
            icon="close"
            label={`Close ${title}`}
            size="s"
            popovertarget={id}
            popovertargetaction="hide"
          />
        </div>
        <div class="popover-body">{children}</div>
      </div>
    </>
  );
}
