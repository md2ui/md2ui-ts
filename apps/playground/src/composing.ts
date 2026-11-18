// An unsent draft keeps the user typing through a pause, so a grace waits for a reply
// still being written (md2ui `app_prompt.PromptBar.composing`).
import type { WireClient } from "@md2ui/wire";

/**
 * How often the field is looked at. md2ui looks each frame; the client's throttle keeps
 * either to one typing frame a second, so a tick only has to come round within it.
 */
const TICK_MS = 250;

/**
 * Each tick, a field holding a draft says the user is typing. A blank field says nothing,
 * and the client sends nothing while the agent works or awaits what follows its own send,
 * when md2ui's field is locked. Returns what stops it.
 */
export function keepComposing(
  field: { readonly value: string },
  client: Pick<WireClient, "sendTyping">,
): () => void {
  const timer = setInterval(() => {
    if (field.value.trim() !== "") client.sendTyping();
  }, TICK_MS);
  return () => clearInterval(timer);
}
