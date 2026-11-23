import { createContext, useContext } from "solid-js"
import type { Family } from "./buckets"

/**
 * One series family in focus across the dashboard: hover "Reasoning" in the legend and every violet part on every
 * chart stays lit while the rest dims. Elements opt in with `data-fam`; the root carries `data-focus`, and the CSS
 * does the rest, so the charts don't re-render on hover.
 */
export interface Focus {
  readonly set: (family: Family | undefined) => void
}

export const FocusContext = createContext<Focus>({ set: () => {} })

export const useFocus = () => useContext(FocusContext)

/** Props for an element that belongs to a family: marks it and focuses the family while hovered. */
export const famProps = (focus: Focus, family: string | undefined) =>
  family
    ? {
        "data-fam": family,
        onPointerEnter: () => focus.set(family as Family),
        onPointerLeave: () => focus.set(undefined),
      }
    : {}
