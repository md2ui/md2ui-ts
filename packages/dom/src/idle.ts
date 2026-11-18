// Deferrable work (ADR-007): image requests, releasing a replaced highlighter. Shared by
// the view and its pipeline session, which may run in a Worker.

/**
 * Runs `work` when the thread is idle; soon, where there is no idle callback (Safari,
 * and every Worker).
 */
export function whenIdle(work: () => void): void {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => work());
  else setTimeout(work, 0);
}
