"use client"

import {
  useCallback,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type TextareaHTMLAttributes,
} from "react"

/**
 * A textarea that is always exactly as tall as the text inside it.
 *
 * WHY THIS EXISTS. The campaign brief was built from single-line `<input>`s for
 * the list fields and fixed-height `<textarea>`s for the prose. Both hide text
 * rather than showing it: an input scrolls sideways, so a client targeting ten
 * roles shows three and a half of them, and a fixed textarea grows an inner
 * scrollbar that nobody notices is there. Anthony Negri's Primary Roles is the
 * case that surfaced it. A brief is a document somebody has to READ before they
 * can act on it, so every field has to show all of itself.
 *
 * The measurement is the honest one: set the height to `auto`, read
 * `scrollHeight`, then set the height to that. `scrollHeight` is only the true
 * content height once the element is not already constrained, which is why the
 * reset is not redundant.
 *
 * `overflowY: hidden` and `resize: none` are not cosmetic. Leaving overflow on
 * lets a rounding error produce a one-pixel scrollbar over the last line, and a
 * resize handle on a box that sizes itself is a control that fights the
 * component.
 */
export function AutoGrowTextarea({
  value,
  minRows = 1,
  style,
  ...rest
}: {
  value: string
  /** Floor, in lines. The box never renders shorter than this. */
  minRows?: number
  style?: CSSProperties
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "style" | "rows">) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const fit = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    // THE BORDER HAS TO BE ADDED BACK, and leaving it out is a real bug rather
    // than a rounding detail. `scrollHeight` is content plus padding and
    // EXCLUDES the border, but these boxes are `border-box`, so a height of
    // scrollHeight makes the content area two pixels shorter than the text
    // inside it. With overflow hidden that clips silently: measured on the
    // brief, every field sat at scrollHeight 144 in a clientHeight of 142.
    const cs = getComputedStyle(el)
    const border =
      cs.boxSizing === "border-box"
        ? (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)
        : 0
    el.style.height = `${el.scrollHeight + border}px`
  }, [])

  // Layout, not effect: measuring after paint shows the box at the wrong height
  // for a frame, which reads as a flicker every time a suggestion is accepted.
  useLayoutEffect(() => {
    fit()
  }, [fit, value])

  // A WIDTH change rewraps the text, which changes the height, and nothing else
  // tells us it happened: the modal is a responsive grid, so the same ten roles
  // are two lines in one column and five in another.
  //
  // ONLY ON WIDTH. This observes the element whose height it is about to set,
  // so reacting to height would feed itself forever. The remembered width is
  // what makes that impossible rather than merely unlikely.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === "undefined") return
    let lastWidth = el.getBoundingClientRect().width
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      if (w === lastWidth) return
      lastWidth = w
      fit()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])

  return (
    <textarea
      ref={ref}
      value={value}
      rows={minRows}
      // Typing is the common case and does not always go through a React state
      // change on the same tick, so the box resizes on input as well.
      onInput={fit}
      style={{ ...style, overflowY: "hidden", resize: "none" }}
      {...rest}
    />
  )
}
