export function Spinner({ size = 16, class: className = "" }) {
  return (
    <svg
      class={`spinner ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle class="spinner-track" cx="12" cy="12" r="9" />
      <circle class="spinner-head" cx="12" cy="12" r="9" />
    </svg>
  );
}
