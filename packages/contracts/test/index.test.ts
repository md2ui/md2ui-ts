import { expect, test } from "vitest";
import type { GroupingDataPoint, GroupingNode } from "../src/index.ts";

test("contracts package loads", async () => {
  // GroupingNode and GroupingDataPoint are type-only exports
  const node: GroupingNode | undefined = undefined;
  const dataPoint: GroupingDataPoint | undefined = undefined;
  expect(node).toBeUndefined();
  expect(dataPoint).toBeUndefined();
});
