import { cloneElement } from "preact";
import { useEffect, useId, useState } from "preact/hooks";

/**
 * A hover/focus tooltip. `aria-describedby` is put on the trigger itself, so
 * the text is announced rather than being purely decorative. Touch pointers
 * are ignored, which is why a tooltip never carries the only copy of an
 * instruction — it explains a control that is already labelled.
 */
export function Tooltip({ text, placement = "top", children }) {
  const auto = useId();
  const id = `tip-${auto}`;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event) => event.key === "Escape" && setOpen(false);
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [open]);

  return (
    <span
      class="tooltip-wrap"
      onPointerEnter={(event) => event.pointerType !== "touch" && setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocusIn={() => setOpen(true)}
      onFocusOut={() => setOpen(false)}
    >
      {cloneElement(children, { "aria-describedby": id })}
      <span
        class={`tooltip tooltip-${placement}`}
        id={id}
        role="tooltip"
        data-open={String(open)}
      >
        {text}
      </span>
    </span>
  );
}
