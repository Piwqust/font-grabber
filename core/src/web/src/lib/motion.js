// The motion layer. Two rules hold everywhere:
//
//  1. `prefers-reduced-motion` wins. Running animations are completed, not
//     abandoned mid-way, so nothing is left half-transformed.
//  2. Keyboard-driven changes skip decorative motion. Someone tabbing through
//     the catalogue should not wait on a spring.
import { animate, spring, stagger, inView } from "motion";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";

export { animate, spring, stagger, inView };

export const EASE = [0.22, 1, 0.36, 1];

const reduced =
  typeof matchMedia === "function"
    ? matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false, addEventListener() {}, removeEventListener() {} };

const running = new Set();
let keyboard = false;

if (typeof document !== "undefined") {
  document.addEventListener("keydown", () => (keyboard = true), true);
  // Moving a pointer at all means the person is back on the mouse, so
  // decorative motion returns without waiting for them to click something.
  const usingPointer = () => (keyboard = false);
  document.addEventListener("pointerdown", usingPointer, true);
  document.addEventListener("pointermove", usingPointer, {
    capture: true,
    passive: true,
  });
  reduced.addEventListener("change", () => {
    if (reduced.matches) for (const control of running) control.complete();
  });
}

export const prefersReduced = () => reduced.matches;
export const fromKeyboard = () => keyboard;

/** `animate`, but a no-op under reduced motion or keyboard navigation. */
export function play(target, frames, options) {
  if (!target || reduced.matches || keyboard) return null;
  const control = animate(target, frames, options);
  running.add(control);
  Promise.resolve(control)
    .catch(() => {})
    .finally(() => running.delete(control));
  return control;
}

/** `animate` that still runs for keyboard users — for state, not decoration. */
export function playAlways(target, frames, options) {
  if (!target || reduced.matches) return null;
  const control = animate(target, frames, options);
  running.add(control);
  Promise.resolve(control)
    .catch(() => {})
    .finally(() => running.delete(control));
  return control;
}

export function useReducedMotion() {
  const [value, setValue] = useState(reduced.matches);
  useEffect(() => {
    const update = () => setValue(reduced.matches);
    reduced.addEventListener("change", update);
    return () => reduced.removeEventListener("change", update);
  }, []);
  return value;
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof matchMedia === "function" ? matchMedia(query).matches : false,
  );
  useEffect(() => {
    const list = matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/**
 * Marks an element as visible the first time it scrolls into view.
 *
 * The observer is the fast path, and a scroll-driven geometry check is the
 * guarantee. A jump — an anchor link, a restored scroll position, a
 * programmatic scroll — can land past an element without the observer ever
 * delivering an entry for it, and a section stranded at `opacity: 0` is a far
 * worse outcome than a missed fade. So the element is revealed by whichever
 * notices first, and both stop as soon as it has.
 */
export function useInView({ amount = 0.2, margin = "0px 0px -8% 0px" } = {}) {
  const ref = useRef(null);
  // Visible is the default, and hiding is what has to be earned. Every failure
  // path — no observer, reduced motion, an element already on screen — leaves
  // the content readable.
  const [visible, setVisible] = useState(true);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || reduced.matches || typeof IntersectionObserver !== "function")
      return;

    const onScreen = () => {
      const box = node.getBoundingClientRect();
      return box.top < innerHeight * 0.94 && box.bottom > 0;
    };
    if (onScreen()) return;
    setVisible(false);

    let done = false;
    let frame = 0;
    const reveal = () => {
      if (done) return;
      done = true;
      setVisible(true);
      cleanup();
    };
    const check = () => {
      frame = 0;
      if (onScreen()) reveal();
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };

    const stopObserving = inView(node, reveal, { amount, margin });
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll, { passive: true });

    function cleanup() {
      cancelAnimationFrame(frame);
      frame = 0;
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      stopObserving();
    }
    return cleanup;
  }, [amount, margin]);

  return [ref, visible];
}

/**
 * Staggers an entrance across an element's children once it enters the
 * viewport. Returns the ref to attach to the container.
 */
export function useStaggerIn({
  selector = ":scope > *",
  distance = 14,
  duration = 0.5,
  delayStep = 0.06,
  amount = 0.2,
} = {}) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const children = [...node.querySelectorAll(selector)];
    if (!children.length) return;
    if (reduced.matches) {
      for (const child of children) child.style.opacity = "";
      return;
    }
    for (const child of children) child.style.opacity = "0";
    return inView(
      node,
      () => {
        playAlways(
          children,
          {
            opacity: [0, 1],
            transform: [`translateY(${distance}px)`, "translateY(0px)"],
          },
          { duration, delay: stagger(delayStep), ease: EASE },
        );
        // Clear the inline hide even if the animation is skipped.
        for (const child of children) child.style.opacity = "";
        return () => {};
      },
      { amount },
    );
  }, [selector, distance, duration, delayStep, amount]);
  return ref;
}

/**
 * Scroll-linked parallax. `strength` is the pixel offset applied across one
 * viewport of scrolling; positive values trail the scroll.
 */
export function useParallax(strength = 40) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || reduced.matches || strength === 0) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const centre = rect.top + rect.height / 2;
      const progress = (centre - innerHeight / 2) / innerHeight;
      node.style.setProperty("--parallax", `${progress * strength}px`);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      node.style.removeProperty("--parallax");
    };
  }, [strength]);
  return ref;
}

/** Animates a sliding indicator to sit under the active element of a group. */
export function useSlidingIndicator(activeKey) {
  const groupRef = useRef(null);
  const indicatorRef = useRef(null);
  const previous = useRef(null);

  const settle = useCallback((animateChange) => {
    const group = groupRef.current;
    const indicator = indicatorRef.current;
    const active = group?.querySelector('[data-active="true"]');
    if (!group || !indicator || !active) return;
    const frame = {
      x: active.offsetLeft - group.clientLeft,
      width: active.offsetWidth,
      height: active.offsetHeight,
      y: active.offsetTop - group.clientTop,
    };
    indicator.style.height = `${frame.height}px`;
    indicator.style.top = `${frame.y}px`;
    if (animateChange && !reduced.matches) {
      playAlways(
        indicator,
        { x: frame.x, width: frame.width },
        { type: spring, duration: 0.32, bounce: 0.12 },
      );
    } else {
      indicator.style.transform = `translateX(${frame.x}px)`;
      indicator.style.width = `${frame.width}px`;
    }
  }, []);

  useLayoutEffect(() => {
    const changed = previous.current !== null && previous.current !== activeKey;
    previous.current = activeKey;
    settle(changed);
  }, [activeKey, settle]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const observer = new ResizeObserver(() => settle(false));
    observer.observe(group);
    for (const child of group.children) observer.observe(child);
    return () => observer.disconnect();
  }, [settle]);

  return { groupRef, indicatorRef };
}

/**
 * Counts up to a number when the element first appears. Used for the result
 * counts, where watching the number land reads as "this just finished".
 */
export function useCountUp(value, { duration = 0.7 } = {}) {
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);
  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (reduced.matches || from === value) {
      setDisplay(value);
      return;
    }
    const control = animate(from, value, {
      duration,
      ease: EASE,
      onUpdate: (n) => setDisplay(Math.round(n)),
    });
    return () => control.stop();
  }, [value, duration]);
  return display;
}
