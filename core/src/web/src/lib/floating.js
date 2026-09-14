import { useCallback, useLayoutEffect, useRef } from "preact/hooks";
import {
  computePosition,
  flip,
  shift,
  offset,
  autoUpdate,
} from "@floating-ui/dom";

/**
 * Positions a floating element relative to an anchor.
 *
 * Returns refs for both and an `update` you can call after the floating
 * element is shown (e.g. after `showPopover()`).
 *
 * `strategy` must match the floating element's CSS `position`: a panel in the
 * top layer is `fixed`, an element inside a positioned wrapper is `absolute`.
 * Getting this wrong puts the panel in the right place until the page scrolls.
 *
 * @param {{placement?:string, offsetPx?:number, padding?:number, strategy?:"absolute"|"fixed"}} options
 */
export function useFloating({
  placement = "bottom-end",
  offsetPx = 10,
  padding = 16,
  strategy = "absolute",
} = {}) {
  const anchorRef = useRef(null);
  const floatingRef = useRef(null);
  const cleanupRef = useRef(null);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!anchor || !floating) return;
    computePosition(anchor, floating, {
      placement,
      strategy,
      middleware: [
        offset(offsetPx),
        flip({ padding }),
        shift({ padding }),
      ],
    }).then(({ x, y }) => {
      floating.style.top = `${y}px`;
      floating.style.left = `${x}px`;
      floating.style.bottom = "auto";
      floating.style.right = "auto";
    });
  }, [placement, offsetPx, padding, strategy]);

  /** Call when the floating element becomes visible. */
  const startAutoUpdate = useCallback(() => {
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!anchor || !floating) return;
    // Clean up any previous auto-update.
    cleanupRef.current?.();
    cleanupRef.current = autoUpdate(anchor, floating, reposition);
  }, [reposition]);

  /** Call when the floating element is hidden. */
  const stopAutoUpdate = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  useLayoutEffect(() => () => cleanupRef.current?.(), []);

  return { anchorRef, floatingRef, reposition, startAutoUpdate, stopAutoUpdate };
}
