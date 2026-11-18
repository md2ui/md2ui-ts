// A control written `~~` (md2ui `render_counts.muted_paint`): a slider, a task box or a
// count whose payload is `disabled` is painted whole at the default mute, in its own
// unchanged box. No `Disabled …` theme key names a slider's, a count's or a box's
// colours, so the fade is the state.
import type { SizedNode } from "../../measure/node-index.ts";
import type { BoxDrawer } from "./context.ts";
import { MUTED_OPACITY } from "./muted.ts";

/**
 * `draw`, a control's drawer, as md2ui `muted_paint` wraps it: when `nd` is `disabled`,
 * one layer at `MUTED_OPACITY`, so a part over another (a knob over its track, a sign
 * over its button) still hides it.
 */
export function mutedControl(nd: SizedNode, draw: BoxDrawer): BoxDrawer {
  if (nd.drawing_element?.["disabled"] !== true) return draw;
  return (d, box, p) => p.layer(MUTED_OPACITY, (layer) => draw(d, box, layer));
}
