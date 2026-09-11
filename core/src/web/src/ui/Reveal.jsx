import { useInView } from "../lib/motion.js";

/**
 * Reveals its children the first time they scroll into view. The entrance is
 * CSS-driven off `data-visible`, so it costs nothing per frame and collapses to
 * "already visible" under reduced motion.
 */
export function Reveal({
  children,
  as: Tag = "div",
  delay = 0,
  from = "up",
  amount = 0.2,
  class: className = "",
  ...rest
}) {
  const [ref, visible] = useInView({ amount });
  return (
    <Tag
      ref={ref}
      class={`reveal reveal-${from} ${className}`.trim()}
      data-visible={String(visible)}
      style={delay ? `--reveal-delay:${delay}ms` : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Reveals each child in turn. Children get the stagger, the container does not. */
export function RevealGroup({
  children,
  as: Tag = "div",
  step = 70,
  from = "up",
  amount = 0.15,
  class: className = "",
  ...rest
}) {
  const [ref, visible] = useInView({ amount });
  const items = Array.isArray(children) ? children : [children];
  return (
    <Tag ref={ref} class={className} {...rest}>
      {items.map((child, index) => (
        <div
          key={index}
          class={`reveal reveal-${from}`}
          data-visible={String(visible)}
          style={`--reveal-delay:${index * step}ms`}
        >
          {child}
        </div>
      ))}
    </Tag>
  );
}
