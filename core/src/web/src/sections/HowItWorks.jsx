import { useEffect, useRef, useState } from "preact/hooks";
import { useInView, useParallax } from "../lib/motion.js";
import { Icon } from "../ui/Icon.jsx";
import { Reveal } from "../ui/Reveal.jsx";

const STEPS = [
  {
    icon: "search",
    title: "Scan",
    body: "Fount reads the page and its stylesheets. When a site loads its type from script, it renders the page in a real browser and collects what appears.",
    detail: "@font-face · CSS · dynamic",
  },
  {
    icon: "layers",
    title: "Compare",
    body: "Faces are grouped into families and previewed in their own type. Set your own words and size, and check that the characters you need are actually in the file.",
    detail: "families · live preview · coverage",
  },
  {
    icon: "download",
    title: "Export",
    body: "Pick the faces worth keeping. Fount converts them to TTF or OTF and hands back a ZIP — or writes them straight to a folder on your machine.",
    detail: "TTF · OTF · ZIP",
  },
];

/**
 * The three steps, tied to a rule that fills as the section is scrolled. The
 * fill is decoration: the steps read the same when it never moves.
 */
export function HowItWorks() {
  const [ref, visible] = useInView({ amount: 0.1 });
  const [active, setActive] = useState(0);
  const stepsRef = useRef(null);

  useEffect(() => {
    const node = stepsRef.current;
    if (!node) return;
    const items = [...node.querySelectorAll(".step")];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) setActive(items.indexOf(entry.target));
      },
      { rootMargin: "-40% 0px -45% 0px" },
    );
    for (const item of items) observer.observe(item);
    return () => observer.disconnect();
  }, []);

  return (
    <section class="section how" id="how" ref={ref} aria-labelledby="how-title">
      <div class="section-head">
        <Reveal as="p" class="eyebrow">
          How it works
        </Reveal>
        <Reveal as="h2" class="section-title" id="how-title" delay={60}>
          Three steps between a page
          <br /> and the files.
        </Reveal>
      </div>

      <ol
        class="steps"
        ref={stepsRef}
        data-visible={String(visible)}
        style={`--active:${active}`}
      >
        {STEPS.map((step, index) => (
          <li
            class="step"
            key={step.title}
            data-active={String(index === active)}
            style={`--reveal-delay:${index * 90}ms`}
          >
            <span class="step-index" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span class="step-mark">
              <Icon name={step.icon} size={22} />
            </span>
            <h3 class="step-title">{step.title}</h3>
            <p class="step-body">{step.body}</p>
            <p class="step-detail">{step.detail}</p>
          </li>
        ))}
      </ol>
      <Rule />
    </section>
  );
}

function Rule() {
  const ref = useParallax(28);
  return <div class="how-rule" ref={ref} aria-hidden="true" />;
}
