// Direct-manipulation behaviour for the specimen cards on the landing page.
//
// One hook drives the whole surface: pointer tilt, a light sheen that tracks
// the cursor, free-form drag-and-drop, and keyboard equivalents so the same
// card can be nudged and cycled without a mouse. Transforms are written
// straight to the node rather than through state, because these run at pointer
// frequency and must not re-render the tree.
//
// A dropped card stays where it was left. The offset from its CSS resting spot
// is the card's position; everything else (tilt, lift, the rotation that
// trails a fast drag) is layered on top of it and falls away on release.
import { useEffect, useRef } from "preact/hooks";
import { playAlways, prefersReduced, EASE } from "./motion.js";
import { cardPosition, forgetCardPosition, rememberCardPosition } from "./storage.js";

const TILT = 10;
const LIFT = 14;
const NUDGE = 10;
const NUDGE_FAST = 24;
/** A card can always be grabbed again: this much of it stays on screen. */
const KEEP_VISIBLE = 48;
/** Below this the pointer was steady enough to count as a click, not a drag. */
const DRAG_THRESHOLD = 6;

/**
 * @param {object} options
 * @param {string} options.id             Stable key used to persist the position.
 * @param {() => void} options.onActivate Click / Enter / Space, but not after a drag.
 * @param {boolean} options.movable       Whether this card can be dragged or nudged.
 * @param {number} options.resetSignal    Bump to send the card back to its spot.
 * @param {(moved: boolean) => void} options.onMove  Called when the card is moved or reset.
 * @param {number} options.tilt           Degrees of tilt at the card's edge.
 * @param {number} options.enterDelay     Seconds to wait before the entrance.
 * @returns ref for the card element.
 */
export function useSpecimenCard({
  id,
  onActivate,
  movable = true,
  resetSignal = 0,
  onMove,
  tilt = TILT,
  enterDelay = 0,
} = {}) {
  const ref = useRef(null);
  // Live configuration. The main effect runs once and reads through this, so
  // crossing the stage breakpoint never replays the entrance animation.
  const config = useRef(null);
  config.current = { id, onActivate, movable, onMove, tilt, enterDelay };
  // Imperative handles the small effects below reach for.
  const api = useRef({});

  useEffect(() => {
    const card = ref.current;
    if (!card) return;

    let control = null;
    let drag = null;
    let moved = false;
    let base = 0;
    let hovering = false;
    let suppressClickUntil = 0;
    // The committed offset from the resting spot, in CSS pixels.
    let pos = config.current.movable
      ? cardPosition(config.current.id)
      : { x: 0, y: 0 };
    // Whether the offset is currently applied. In strip mode it is not, but the
    // stored position survives so returning to a wide window restores it.
    let applied = config.current.movable;

    const readBase = () =>
      parseFloat(getComputedStyle(card).getPropertyValue("--angle")) || 0;
    base = readBase();

    const at = () => (applied ? pos : { x: 0, y: 0 });

    // One place builds the transform, so nothing else ever writes to it and
    // the hook can hand Motion complete strings rather than partial keyframes.
    const write = ({
      x = 0,
      y = 0,
      rx = 0,
      ry = 0,
      lift = 0,
      scale = 1,
      turn = base,
    }) =>
      `translate3d(${x}px, ${y - lift}px, 0) rotate(${turn}deg) rotateX(${rx}deg) rotateY(${ry}deg) scale(${scale})`;

    const stop = () => {
      control?.stop();
      control = null;
    };

    /**
     * The card's box with no offset applied, in page coordinates. Read from
     * layout (`offsetLeft`/`offsetTop`) rather than `getBoundingClientRect`,
     * because the rect is whatever the live transform — tilt, lift, rotation —
     * currently makes it, and this has to be a fixed reference.
     */
    const restBox = () => {
      const parent = card.offsetParent;
      const origin = parent
        ? parent.getBoundingClientRect()
        : { left: -scrollX, top: -scrollY };
      return {
        left: origin.left + card.offsetLeft + scrollX,
        top: origin.top + card.offsetTop + scrollY,
        width: card.offsetWidth,
        height: card.offsetHeight,
      };
    };

    /**
     * Keeps a card reachable. Offsets are clamped so at least KEEP_VISIBLE
     * pixels of the card stay inside the viewport horizontally and inside the
     * document vertically — a card can be parked anywhere, never lost.
     */
    const clamp = (next) => {
      const box = restBox();
      const page = Math.max(
        innerHeight,
        document.documentElement.scrollHeight || 0,
      );
      return {
        x: Math.max(
          KEEP_VISIBLE - box.left - box.width + scrollX,
          Math.min(innerWidth + scrollX - KEEP_VISIBLE - box.left, next.x),
        ),
        y: Math.max(
          KEEP_VISIBLE - box.top - box.height,
          Math.min(page - KEEP_VISIBLE - box.top, next.y),
        ),
      };
    };

    // Pointer response is written straight to the element and eased by CSS:
    // `.card` carries a short transition for tilt tracking, `.is-settling` a
    // longer overshooting one for the release, and `.is-dragging` none at all.
    // Keeping one writer for `transform` is what makes drag, tilt and release
    // compose instead of fighting each other.
    const settle = (immediate = false) => {
      stop();
      card.style.removeProperty("--sheen-x");
      card.style.removeProperty("--sheen-y");
      card.style.removeProperty("--sheen-opacity");
      const rest = write(at());
      card.classList.remove("is-settling");
      if (immediate || prefersReduced()) {
        card.style.transform = rest;
        return;
      }
      card.classList.add("is-settling");
      card.style.transform = rest;
      card.addEventListener(
        "transitionend",
        () => card.classList.remove("is-settling"),
        { once: true },
      );
    };

    const mark = () => {
      const away = applied && (pos.x !== 0 || pos.y !== 0);
      card.classList.toggle("is-moved", away);
      config.current.onMove?.(away);
    };

    const commit = (next) => {
      pos = next;
      rememberCardPosition(config.current.id, pos);
      mark();
    };

    /** Back to the CSS resting spot, and forget the stored offset. */
    const home = () => {
      forgetCardPosition(config.current.id);
      pos = { x: 0, y: 0 };
      mark();
      settle();
    };

    const cancelDrag = () => {
      if (drag && card.hasPointerCapture(drag.id))
        card.releasePointerCapture(drag.id);
      drag = null;
      card.classList.remove("is-dragging");
      settle(true);
    };

    const onPointerDown = (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      if (!config.current.movable) return;
      stop();
      moved = false;
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        time: event.timeStamp,
        velocity: 0,
        from: { ...pos },
      };
      card.setPointerCapture(event.pointerId);
      card.classList.add("is-dragging");
    };

    const onPointerMove = (event) => {
      const rect = card.getBoundingClientRect();
      if (!prefersReduced()) {
        // The sheen follows the pointer across the card in both modes.
        card.style.setProperty(
          "--sheen-x",
          `${((event.clientX - rect.left) / rect.width) * 100}%`,
        );
        card.style.setProperty(
          "--sheen-y",
          `${((event.clientY - rect.top) / rect.height) * 100}%`,
        );
      }

      if (drag) {
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD) moved = true;
        const elapsed = Math.max(1, event.timeStamp - drag.time);
        drag.velocity = (event.clientX - drag.lastX) / elapsed;
        drag.lastX = event.clientX;
        drag.time = event.timeStamp;
        drag.to = clamp({ x: drag.from.x + dx, y: drag.from.y + dy });
        if (!prefersReduced())
          card.style.setProperty("--sheen-opacity", "1");
        card.style.transform = write({
          x: drag.to.x,
          y: drag.to.y,
          lift: prefersReduced() ? 0 : LIFT,
          turn: prefersReduced()
            ? base
            : base + (drag.to.x - drag.from.x) * 0.02 + drag.velocity * 6,
        });
        return;
      }

      if (!hovering || prefersReduced()) return;
      const here = at();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      const tilted = write({
        x: here.x + px * 10,
        y: here.y + py * 8,
        rx: -py * config.current.tilt,
        ry: px * config.current.tilt,
        lift: LIFT * 0.5,
        turn: base + px * 3,
      });
      stop();
      card.style.setProperty("--sheen-opacity", "1");
      // Tilt tracks the pointer at pointer frequency; writing it straight to
      // the element beats queuing a 250ms animation per move event.
      card.style.transform = tilted;
    };

    const onPointerUp = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      // Swallow the click the browser fires at the end of a drag. A deadline
      // rather than a one-shot listener, because a drag that ends outside the
      // card produces no click at all — and a listener left armed would then
      // eat the next real one.
      if (moved) suppressClickUntil = event.timeStamp + 300;
      // The card stays where it was dropped; only the lift and the trailing
      // rotation are given back.
      if (moved && drag.to) commit(clamp(drag.to));
      drag = null;
      card.releasePointerCapture(event.pointerId);
      card.classList.remove("is-dragging");
      settle();
    };

    const onEnter = () => {
      hovering = true;
    };
    const onLeave = () => {
      hovering = false;
      if (!drag) settle();
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        if (drag) cancelDrag();
        home();
        return;
      }
      if (!config.current.movable) return;
      const step = event.shiftKey ? NUDGE_FAST : NUDGE;
      const nudges = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const nudge = nudges[event.key];
      if (!nudge) return;
      event.preventDefault();
      commit(clamp({ x: pos.x + nudge[0], y: pos.y + nudge[1] }));
      card.style.transform = write(at());
    };

    const onClick = (event) => {
      if (event.timeStamp < suppressClickUntil) {
        suppressClickUntil = 0;
        return;
      }
      if (getSelection()?.toString()) return;
      event.preventDefault();
      config.current.onActivate?.();
    };

    // A drag is a drag: no text selection, no native image drag behind it.
    const onDragStart = (event) => event.preventDefault();

    card.addEventListener("pointerdown", onPointerDown);
    card.addEventListener("pointermove", onPointerMove);
    card.addEventListener("pointerup", onPointerUp);
    card.addEventListener("pointercancel", cancelDrag);
    card.addEventListener("lostpointercapture", () => drag && cancelDrag());
    card.addEventListener("pointerenter", onEnter);
    card.addEventListener("pointerleave", onLeave);
    card.addEventListener("keydown", onKeyDown);
    card.addEventListener("click", onClick);
    card.addEventListener("dragstart", onDragStart);

    // Entrance. It lives here because this hook owns `transform`; running it
    // from the section would fight the resting state written above.
    mark();
    const rest = write(at());
    card.style.transform = rest;
    if (prefersReduced()) {
      card.style.opacity = "";
    } else {
      card.style.opacity = "0";
      const from = at();
      const entrance = playAlways(
        card,
        {
          opacity: [0, 1],
          transform: [
            write({ ...from, scale: 0.93, y: from.y + 10 }),
            rest,
          ],
        },
        { duration: 0.65, delay: config.current.enterDelay ?? 0, ease: EASE },
      );
      Promise.resolve(entrance)
        .catch(() => {})
        .finally(() => {
          card.style.opacity = "";
        });
    }

    const observer = new ResizeObserver(() => {
      base = readBase();
      if (!drag) settle(true);
    });
    observer.observe(card);

    // A narrower window can leave a parked card off-screen; pull it back in.
    const onResize = () => {
      if (drag || !applied) return;
      const next = clamp(pos);
      if (next.x !== pos.x || next.y !== pos.y) commit(next);
      settle(true);
    };
    addEventListener("resize", onResize);

    const onHidden = () => document.hidden && drag && cancelDrag();
    document.addEventListener("visibilitychange", onHidden);

    api.current = {
      home,
      setApplied: (next) => {
        if (next === applied) return;
        applied = next;
        // Coming back to a wide window re-reads the store, so a reset that
        // happened while the strip was showing is honoured.
        if (next) pos = cardPosition(config.current.id);
        if (drag) cancelDrag();
        mark();
        settle(true);
      },
    };

    return () => {
      stop();
      observer.disconnect();
      removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onHidden);
      card.removeEventListener("pointerdown", onPointerDown);
      card.removeEventListener("pointermove", onPointerMove);
      card.removeEventListener("pointerup", onPointerUp);
      card.removeEventListener("pointercancel", cancelDrag);
      card.removeEventListener("pointerenter", onEnter);
      card.removeEventListener("pointerleave", onLeave);
      card.removeEventListener("keydown", onKeyDown);
      card.removeEventListener("click", onClick);
      card.removeEventListener("dragstart", onDragStart);
    };
    // Runs once: everything that changes is read live through `config`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Strip mode parks the cards at their CSS spots without forgetting where
  // they were put; a wide window brings the arrangement back.
  useEffect(() => {
    api.current.setApplied?.(movable);
  }, [movable]);

  const firstReset = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal === firstReset.current) return;
    api.current.home?.();
  }, [resetSignal]);

  return ref;
}
