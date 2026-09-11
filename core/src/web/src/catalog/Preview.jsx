import { usePreview, previewFamily } from "../lib/previews.js";

/**
 * A line of sample text set in the face itself. The real file is fetched when
 * the line approaches the viewport; until then, and if the fetch fails, a
 * fallback is shown and said so, rather than silently lying about the shapes.
 */
export function Preview({ font, text, class: className = "" }) {
  const { ref, state } = usePreview(font);
  return (
    <div class={`preview-wrap ${className}`.trim()}>
      <p
        ref={ref}
        class={`preview is-${state}`}
        style={
          state === "ready"
            ? `font-family:"${previewFamily(font.id)}", serif`
            : undefined
        }
      >
        {text}
      </p>
      {state === "failed" ? (
        <p class="preview-note">Preview unavailable. Fallback font shown.</p>
      ) : null}
    </div>
  );
}
