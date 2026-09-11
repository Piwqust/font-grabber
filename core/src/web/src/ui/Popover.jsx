import { cloneElement } from "preact";
import { useCallback, useEffect, useId, useRef, useState } from "preact/hooks";
import { play, EASE } from "../lib/motion.js";
import { IconButton } from "./Button.jsx";

/**
 * A panel anchored to a trigger, built on the native popover API so light
 * dismiss, Escape and the top layer come from the platform. Positioning is
 * done here because CSS anchor positioning is not available everywhere yet:
 * it prefers below the trigger, flips above when there is no room, and is
 * always clamped inside the viewport.
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
  const panelRef = useRef(null);
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);

  const position = useCallback(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor || !panel.matches(":popover-open")) return;
    const box = anchor.getBoundingClientRect();
    panel.style.maxHeight = `${Math.max(120, innerHeight - 32)}px`;
    const { height, width } = panel.getBoundingClientRect();
    const below = box.bottom + 10;
    const top =
      below + height <= innerHeight - 16 ? below : box.top - height - 10;
    const left = placement.endsWith("end") ? box.right - width : box.left;
    panel.style.top = `${Math.max(16, Math.min(top, innerHeight - height - 16))}px`;
    panel.style.left = `${Math.max(16, Math.min(left, innerWidth - width - 16))}px`;
    panel.style.bottom = "auto";
    panel.style.right = "auto";
  }, [placement]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onToggle = (event) => {
      const isOpen = event.newState === "open";
      setOpen(isOpen);
      if (isOpen) {
        position();
        play(
          panel,
          {
            opacity: [0, 1],
            // Both keyframes spell out the same transform functions: Motion
            // resolves a bare "none" against them to a zero matrix.
            transform: [
              "scale(0.97) translateY(-4px)",
              "scale(1) translateY(0px)",
            ],
          },
          { duration: 0.18, ease: EASE },
        );
        // Focus the first control so the panel is usable straight from the keyboard.
        panel.querySelector("input, select, button, [tabindex]")?.focus();
      } else if (
        panel.contains(document.activeElement) ||
        document.activeElement === document.body
      ) {
        anchorRef.current?.focus({ preventScroll: true });
      }
    };
    panel.addEventListener("toggle", onToggle);
    addEventListener("resize", position);
    addEventListener("scroll", position, { passive: true });
    return () => {
      panel.removeEventListener("toggle", onToggle);
      removeEventListener("resize", position);
      removeEventListener("scroll", position);
    };
  }, [position]);

  return (
    <>
      {cloneElement(trigger, {
        ref: anchorRef,
        popovertarget: id,
        "aria-expanded": open,
      })}
      <div class="popover" id={id} popover="auto" ref={panelRef}>
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
