import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { play, stagger, useMediaQuery, EASE } from "../lib/motion.js";
import {
  cardLayoutFits,
  cardPositions,
  clearCardPositions,
} from "../lib/storage.js";
import { ScanForm } from "./ScanForm.jsx";
import { SpecimenStage, STAGE_QUERY } from "./SpecimenStage.jsx";
import { Icon } from "../ui/Icon.jsx";
import { IconButton } from "../ui/Button.jsx";
import { Tooltip } from "../ui/Tooltip.jsx";

/**
 * The whole of the first screen, and deliberately the only thing on it: the
 * claim, the address bar, and specimens to play with. Everything that explains
 * or qualifies the product lives further down the page.
 *
 * The hero also owns the specimen arrangement, because the control that puts a
 * moved card back belongs next to the scroll cue rather than inside the stage.
 */
export function Hero() {
  const ref = useRef(null);
  const wide = useMediaQuery(STAGE_QUERY);
  const [moved, setMoved] = useState(
    () => wide && Object.keys(cardPositions()).length > 0,
  );
  const [resetSignal, setResetSignal] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // The cards run their own entrance inside useSpecimenCard, which owns their
    // transform; this covers the copy and the address bar only.
    play(
      node.querySelectorAll("[data-enter]"),
      { opacity: [0, 1], transform: ["translateY(14px)", "translateY(0px)"] },
      { duration: 0.55, delay: stagger(0.07), ease: EASE },
    );
  }, []);

  const reset = useCallback(() => {
    clearCardPositions();
    setMoved(false);
    setResetSignal((n) => n + 1);
  }, []);

  // Offsets only mean something at the width they were measured at. Once the
  // window has changed size enough, the arrangement is dropped rather than
  // left pointing at places that have moved.
  useEffect(() => {
    const onResize = () => {
      if (!cardLayoutFits()) reset();
    };
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, [reset]);

  return (
    <section class="hero" ref={ref} aria-labelledby="hero-title">
      {/* The stage follows the copy in the DOM so the address field is reached
          before four specimen cards. Its position is set by CSS either way. */}
      <div class="hero-copy">
        <h1 class="hero-title" id="hero-title" data-enter>
          Find the fonts
          <br />
          <em>behind</em> any website.
        </h1>
        <p class="hero-lede" data-enter>
          Paste an address. Fount reads the page, groups what it finds into
          families, and hands you clean TTF or OTF files.
        </p>
        <div data-enter>
          <ScanForm />
        </div>
      </div>

      <SpecimenStage
        resetSignal={resetSignal}
        onMove={() => setMoved(Object.keys(cardPositions()).length > 0)}
      />

      <div class="hero-cue" data-enter>
        <a class="scroll-cue" href="#how">
          <span>How it works</span>
          <Icon name="chevronDown" size={16} />
        </a>
        {wide && moved ? (
          <Tooltip text="Put the specimens back">
            <IconButton
              icon="refresh"
              size="s"
              variant="quiet"
              label="Reset the specimen layout"
              onClick={reset}
            />
          </Tooltip>
        ) : null}
      </div>
    </section>
  );
}
