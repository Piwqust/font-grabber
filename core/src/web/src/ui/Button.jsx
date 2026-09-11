import { forwardRef } from "preact/compat";
import { usePressScale } from "../lib/interaction.js";
import { Icon } from "./Icon.jsx";
import { Spinner } from "./Spinner.jsx";

/**
 * The one button in the system.
 *
 *   variant  solid | outline | quiet | text | chip
 *   size     s | m | l
 *   busy     swaps the leading icon for a spinner and marks it aria-busy
 *
 * Props this does not consume land on the element, so callers keep access to
 * `popovertarget`, `form`, `aria-*` and friends.
 */
export const Button = forwardRef(function Button(
  {
    variant = "outline",
    size = "m",
    busy = false,
    icon,
    iconEnd,
    full = false,
    as,
    class: className = "",
    children,
    disabled,
    type,
    ...rest
  },
  ref,
) {
  const pressRef = usePressScale(size === "l" ? 0.985 : 0.96);
  const Tag = as || "button";
  const glyph = size === "s" ? 15 : 18;
  const classes = [
    "btn",
    `btn-${variant}`,
    `btn-${size}`,
    full && "btn-full",
    busy && "is-busy",
    !children && "btn-square",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Tag
      ref={(node) => {
        pressRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      class={classes}
      disabled={Tag === "button" ? disabled || busy : undefined}
      aria-busy={busy ? "true" : undefined}
      aria-disabled={Tag !== "button" && disabled ? "true" : undefined}
      type={Tag === "button" ? type || "button" : type}
      {...rest}
    >
      {busy ? (
        <Spinner size={glyph} />
      ) : icon ? (
        <Icon name={icon} size={glyph} />
      ) : null}
      {children ? <span class="btn-label">{children}</span> : null}
      {iconEnd ? <Icon name={iconEnd} size={glyph} class="btn-end" /> : null}
    </Tag>
  );
});

/** An icon-only button. `label` becomes the accessible name. */
export const IconButton = forwardRef(function IconButton(
  {
    icon,
    label,
    variant = "quiet",
    size = "m",
    class: className = "",
    ...rest
  },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      icon={icon}
      class={`btn-icon ${className}`.trim()}
      aria-label={label}
      {...rest}
    />
  );
});
