// URL query decoding: `md2ui.*` image params (`urllib.parse.unquote`) and `agent:` action
// params (`urllib.parse.parse_qsl(query, keep_blank_values=True)`).
// Expected values come from Python 3:
//   python3 -c 'from urllib.parse import unquote, parse_qsl; print(unquote(U)); print(parse_qsl(Q, keep_blank_values=True))'
// run for each U and Q below.
import type { GroupingNode } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { actionTargets } from "../src/actions/targets.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { imageParams } from "../src/utils/image-params.ts";

const kit = new RegexKit();

const UNQUOTE: readonly (readonly [string, string])[] = [
  ["%E2%82%AC%E2", "€\u{fffd}"],
  ["%E2%82", "\u{fffd}"],
  ["%F0%9F%98", "\u{fffd}"],
  ["%", "%"],
  ["%2", "%2"],
  ["%G1", "%G1"],
  ["%%41", "%A"],
  ["a+b", "a+b"],
  ["%e2%82%ac", "€"],
  ["%E2%82%AC", "€"],
  ["€x", "€x"],
  ["%3D", "="],
  ["%41%42%c3%a9", "ABé"],
  ["%ED%A0%80", "\u{fffd}\u{fffd}\u{fffd}"],
  ["%C0%80", "\u{fffd}\u{fffd}"],
  ["%F0%9F%98%80%FF", "😀\u{fffd}"],
  // A leading byte order mark is text to Python, not a signature.
  ["%EF%BB%BFa", "\u{feff}a"],
];

test("an image's md2ui param is unquoted as Python's urllib does", () => {
  for (const [raw, decoded] of UNQUOTE) {
    const params = imageParams(kit, `![a](x.jpg?md2ui.k=${raw})`);
    expect(params.get("k"), raw).toBe(decoded);
  }
});

const QSL: readonly (readonly [string, readonly (readonly [string, string])[]])[] = [
  [
    "a=&b",
    [
      ["a", ""],
      ["b", ""],
    ],
  ],
  [
    "a=1&&b=2",
    [
      ["a", "1"],
      ["b", "2"],
    ],
  ],
  ["&&", []],
  ["=v", [["", "v"]]],
  [
    "a=1&a=2&b=3&a=",
    [
      ["a", "1"],
      ["a", "2"],
      ["b", "3"],
      ["a", ""],
    ],
  ],
  ["a=1;b=2", [["a", "1;b=2"]]],
  ["k%3Dx=v%3Dy", [["k=x", "v=y"]]],
  [
    "a=€&é=ü",
    [
      ["a", "€"],
      ["é", "ü"],
    ],
  ],
  [
    "a=%e2%82%ac&%E2%82=%41",
    [
      ["a", "€"],
      ["\u{fffd}", "A"],
    ],
  ],
  ["x+y=a+b", [["x y", "a b"]]],
  [
    "a=%E2%82%AC%E2&b=%F0%9F%98&c=%&d=%2&e=%G1&f=%%41",
    [
      ["a", "€\u{fffd}"],
      ["b", "\u{fffd}"],
      ["c", "%"],
      ["d", "%2"],
      ["e", "%G1"],
      ["f", "%A"],
    ],
  ],
  ["a==b=c", [["a", "=b=c"]]],
  ["a", [["a", ""]]],
  [
    "a=1&b&&c=%E2%82&d=x+y&=v&e=%3D;f=2",
    [
      ["a", "1"],
      ["b", ""],
      ["c", "\u{fffd}"],
      ["d", "x y"],
      ["", "v"],
      ["e", "=;f=2"],
    ],
  ],
];

test("an agent action's params are read as Python's parse_qsl keeping blanks", () => {
  for (const [query, pairs] of QSL) {
    const root = {
      node_id: "0",
      type: "text",
      content: `[go](agent:go?${query})`,
      children: [],
    } as unknown as GroupingNode;
    const [target] = actionTargets(root, kit);
    expect(target?.action?.params, query).toEqual(pairs);
  }
});
