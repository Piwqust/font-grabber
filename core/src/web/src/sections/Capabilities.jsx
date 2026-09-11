import { Icon } from "../ui/Icon.jsx";
import { Reveal, RevealGroup } from "../ui/Reveal.jsx";

const ITEMS = [
  {
    icon: "type",
    title: "Families, not file lists",
    body: "Faces are matched back to the family they belong to, even when the CSS name is obfuscated and the real one survives only in the file name.",
  },
  {
    icon: "spark",
    title: "Variable fonts recognised",
    body: "Variable faces are labelled as such, and a family can be narrowed to only its variable files in one action.",
  },
  {
    icon: "shield",
    title: "Character coverage check",
    body: "Before you commit to a face, check your own text against the actual file and see exactly which characters are missing.",
  },
  {
    icon: "download",
    title: "Clean TTF and OTF",
    body: "Web files are converted rather than renamed, so what lands in your folder opens in a type tool and installs on your system.",
  },
  {
    icon: "keyboard",
    title: "Fully keyboard-driven",
    body: "Every control is reachable and labelled. Motion respects the reduced-motion setting and never gates an action.",
  },
  {
    icon: "globe",
    title: "Runs on your machine",
    body: "The local edition is one binary with the interface built in. Nothing is uploaded, and the scan happens from your own network.",
  },
];

export function Capabilities() {
  return (
    <section
      class="section capabilities"
      id="capabilities"
      aria-labelledby="capabilities-title"
    >
      <div class="section-head">
        <Reveal as="p" class="eyebrow">
          What you get
        </Reveal>
        <Reveal
          as="h2"
          class="section-title"
          id="capabilities-title"
          delay={60}
        >
          Built for the part that
          <br /> usually goes wrong.
        </Reveal>
      </div>

      <RevealGroup class="capability-grid" step={60}>
        {ITEMS.map((item) => (
          <article class="capability" key={item.title}>
            <Icon name={item.icon} size={20} class="capability-mark" />
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
      </RevealGroup>
    </section>
  );
}
