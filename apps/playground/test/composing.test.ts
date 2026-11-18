// md2ui prompt_bar_tests `test_an_unsent_draft_keeps_the_user_typing`: the
// playground's field, through a real wire client, so its throttle and lock are md2ui's.
import { createWireClient } from "@md2ui/wire";
import { afterEach, expect, test, vi } from "vitest";
import { keepComposing } from "../src/composing.ts";

afterEach(() => {
  vi.useRealTimers();
});

test("an unsent draft keeps the user typing through a pause; a blank or locked field does not", async () => {
  vi.useFakeTimers({ toFake: ["performance", "setInterval", "clearInterval"] });
  const sent: string[] = [];
  const client = createWireClient({ transport: { send: (t) => sent.push(t) }, onEvent: () => {} });
  client.hello();
  await client.receive(JSON.stringify({ t: "s", s: "l" }));
  sent.length = 0;
  const field = { value: " " };
  const stop = keepComposing(field, client);

  vi.advanceTimersByTime(3000);
  expect(sent, "a blank field is not a draft").toEqual([]);

  field.value = "a";
  vi.advanceTimersByTime(3000);
  // One a tick at first, then the wire's throttle spaces them a second apart.
  expect(sent).toEqual(['{"t":"k"}', '{"t":"k"}', '{"t":"k"}']);

  await client.receive(JSON.stringify({ t: "s", s: "w" }));
  vi.advanceTimersByTime(3000);
  expect(sent, "nothing while the agent works").toHaveLength(3);

  stop();
  await client.receive(JSON.stringify({ t: "s", s: "l" }));
  vi.advanceTimersByTime(3000);
  expect(sent, "nothing once stopped").toHaveLength(3);
});
