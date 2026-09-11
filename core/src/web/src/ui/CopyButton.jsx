import { useEffect, useRef, useState } from "preact/hooks";
import { Button } from "./Button.jsx";

/**
 * Copies a value and reports the outcome in place. Clipboard access can be
 * refused (insecure context, denied permission), so failure is a visible state
 * with a fallback instruction rather than a silent no-op.
 */
export function CopyButton({
  value,
  label = "Copy",
  successLabel = "Copied",
  errorLabel = "Press Ctrl+C to copy",
  size = "s",
  variant = "quiet",
}) {
  const [state, setState] = useState("idle");
  const timer = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setState("done");
    } catch {
      setState("error");
    }
    timer.current = setTimeout(() => setState("idle"), 2400);
  };

  return (
    <Button
      size={size}
      variant={variant}
      icon={state === "done" ? "check" : "copy"}
      class={`copy-button is-${state}`}
      onClick={copy}
    >
      <span role="status">
        {state === "done"
          ? successLabel
          : state === "error"
            ? errorLabel
            : label}
      </span>
    </Button>
  );
}
