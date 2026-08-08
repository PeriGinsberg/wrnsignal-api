"use client"

// Motion primitives for the Proof Project. Three rules hold across all of them:
//
// 1. REDUCED MOTION IS A REAL SETTING, not a nicety. Every animation here has a
//    static end state, and prefers-reduced-motion jumps straight to it. A page
//    built out of count-ups, glows and flips is exactly the kind that triggers
//    vestibular symptoms, so the setting must land the finished value rather
//    than a slower version of the same movement.
// 2. ONE rAF LOOP PER ANIMATION, cancelled on unmount. No setInterval, no
//    per-frame React state in a list.
// 3. ANIMATE transform AND opacity ONLY. Width/height/top animations force
//    layout on every frame; on a mid-range phone with a dozen nodes that is the
//    difference between smooth and visibly janky.

import { useEffect, useRef, useState, useSyncExternalStore } from "react"

const MOTION_QUERY = "(prefers-reduced-motion: reduce)"

function subscribeMotion(onChange: () => void): () => void {
  const mq = window.matchMedia(MOTION_QUERY)
  mq.addEventListener("change", onChange)
  return () => mq.removeEventListener("change", onChange)
}

/**
 * The user's OS-level reduced-motion preference, live.
 *
 * useSyncExternalStore rather than useState + useEffect: matchMedia IS an
 * external store, and this is what it is for. It also gives the server snapshot
 * (false) separately from the client one, so the markup matches on hydration
 * without a render pass where the value is briefly wrong.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(MOTION_QUERY).matches,
    () => false,
  )
}

/** Cubic ease-out: fast to start, settling at the end. The single easing used
 *  by every fill and count on this page so they feel like one system. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/**
 * Count from 0 to `target` over `durationMs`, eased.
 *
 * Returns an integer, because a percentage flickering through 63.7431 is noise.
 * Re-runs if the target changes (a task completing while the page is open
 * animates from where it was, not from zero).
 */
export function useCountUp(target: number, durationMs = 1400, enabled = true): number {
  const reduced = useReducedMotion()
  const animate = enabled && !reduced
  const [value, setValue] = useState(0)
  const fromRef = useRef(0)

  useEffect(() => {
    // The static case is DERIVED at the return below, not written into state
    // here: a synchronous setState inside an effect is a second render pass for
    // a value we already know.
    if (!animate) {
      fromRef.current = target
      return
    }
    const from = fromRef.current
    const delta = target - from
    if (delta === 0) return

    let raf = 0
    let start = 0
    const step = (ts: number) => {
      if (!start) start = ts
      const t = Math.min(1, (ts - start) / durationMs)
      const next = Math.round(from + delta * easeOutCubic(t))
      setValue(next)
      if (t < 1) {
        raf = requestAnimationFrame(step)
      } else {
        fromRef.current = target
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs, animate])

  return animate ? value : target
}

/**
 * Flips false → true one frame after mount, so a CSS transition has a
 * from-state to animate out of. This is the whole mechanism behind the bars and
 * the node stamps: render at 0, then let CSS carry them to 1.
 *
 * Two rAFs, not one: a single frame can be coalesced with the initial paint, and
 * the transition is then skipped entirely.
 */
export function useMountedFlag(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setOn(true))
    })
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
  }, [])
  return on
}

/**
 * True once the element has been on screen, and it never goes back to false.
 *
 * The journey map and the calendar sit below the fold on a phone. Without this
 * their entrance animations run while nobody is looking and are simply missed;
 * with it, each section plays as it is scrolled to. `once` matters — re-playing
 * on every scroll past would be a toy.
 *
 * Falls back to visible when IntersectionObserver is absent, so a missing API
 * shows content rather than hiding it forever.
 */
export function useInViewOnce<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    if (seen) return
    const el = ref.current
    if (!el) return
    // No IntersectionObserver: show the content rather than hide it forever.
    // Deferred by a timeout so this is not a synchronous setState in an effect.
    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => setSeen(true), 0)
      return () => clearTimeout(t)
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      // A little early, so the animation is already running by the time the
      // section is properly in view rather than starting as it lands.
      { rootMargin: "0px 0px -10% 0px", threshold: 0.01 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen])

  return [ref, seen]
}
