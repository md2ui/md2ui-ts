// How a re-sent or streamed document moves into place: the view runs the frames,
// the painter tweens the lists (`createTransition`), and the platform times and eases
// the progress (Web Animations, ADR-007), each stage of it on its own. A new page fades
// whole on the compositor instead, with no frame of ours. The theme's `## Motion` sets
// the duration and the easing; the user's reduced-motion setting always wins over it.
import type { MotionTheme, ResolvedTheme } from "@md2ui/contracts";
import { parseTheme } from "@md2ui/core";
import { STAGES, type Stages } from "@md2ui/painter-canvas";

/** A tween running on the document timeline. */
export interface Tween {
  /** How far each stage has got, eased: 0 to 1. */
  progress(): Stages;
  /** Whether it has reached its end. */
  done(): boolean;
}

/** The timing a tween of `motion` runs with. */
function timing(motion: MotionTheme): KeyframeEffectOptions {
  return { duration: motion.duration, easing: motion.easing, fill: "forwards" };
}

/**
 * The theme's motion as this browser runs it. The easing is checked by Web Animations
 * itself, the API that will run it, so exactly its syntax is accepted; one it rejects
 * is the default easing, as any THEME.md value that does not read keeps its default.
 * Once per theme.
 */
export function themeMotion(theme: ResolvedTheme): MotionTheme {
  try {
    new KeyframeEffect(null, null, timing(theme.motion));
    return theme.motion;
  } catch {
    return { ...theme.motion, easing: parseTheme("").motion.easing };
  }
}

/** Whether the user asked the system for less motion. */
function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Whether `motion` moves anything here: not at a zero duration, nor for a reader who asked for less. */
const moves = (motion: MotionTheme): boolean => motion.duration > 0 && !reducedMotion();

/**
 * Starts a tween of `motion` (from `themeMotion`), timed and eased by the browser: an
 * animation with no target per stage (`STAGES`), each over its part of the duration
 * with the theme's easing, read each frame. Null when there is nothing to tween: a zero
 * duration, or the user's reduced-motion setting.
 */
export function startTween(motion: MotionTheme): Tween | null {
  if (!moves(motion)) return null;
  const stage = ([start, end]: readonly [number, number]) => {
    const effect = new KeyframeEffect(null, null, {
      ...timing(motion),
      delay: start * motion.duration,
      duration: (end - start) * motion.duration,
      fill: "both",
    });
    const animation = new Animation(effect, document.timeline);
    animation.play();
    return { effect, animation };
  };
  const exit = stage(STAGES.exit);
  const move = stage(STAGES.move);
  const enter = stage(STAGES.enter);
  const at = ({ effect }: typeof exit) => effect.getComputedTiming().progress ?? 1;
  return {
    progress: () => ({ exit: at(exit), move: at(move), enter: at(enter) }),
    done: () => [exit, move, enter].every(({ animation }) => animation.playState === "finished"),
  };
}

/**
 * Fades `element` out over `motion`, on the compositor: no frame of ours runs while it
 * plays. Null when nothing moves, as for `startTween`.
 */
export function startFade(element: Element, motion: MotionTheme): Animation | null {
  if (!moves(motion)) return null;
  return element.animate([{ opacity: 1 }, { opacity: 0 }], timing(motion));
}
