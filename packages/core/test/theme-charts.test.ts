// The chart keys: negative fills, the percent scale, value formats, `### Chart Grid` and `###
// Line Chart`. Ports md2ui's `datapoint_theme_tests` cases and
// `test_a_theme_declares_the_line_to_draw_it`.
import { expect, test } from "vitest";
import { parseTheme } from "../src/index.ts";

const charts = (text: string) => parseTheme(`## Charts\n${text}`).charts;

test("a negative colour fills a bar below zero, per bar family and for charts", () => {
  const theme = parseTheme(
    "## Drawing elements\n### Key Value Bars\nNegative color: #B4B4BB\n" +
      "## Charts\nNegative color: #E5484D\n",
  );
  expect(theme.datapoints.kv_bar.negative_color).toBe(0xffb4b4bb);
  expect(theme.datapoints.ratio_bar.negative_color).toBeNull();
  expect(theme.charts.negative_color).toBe(0xffe5484d);
  expect(charts("Negative color: red\n").negative_color).toBeNull();
});

test("the percent scale and value format accept only their listed values", () => {
  expect(charts("Percent scale: Peak\n").percent_scale).toBe("peak");
  expect(charts("Percent scale: max\n").percent_scale).toBe("100");
  expect(charts("Value format: 1   unit\n").value_format).toBe("1 unit");
  expect(charts("Value format: unit 1\n").value_format).toBe("unit 1");
  expect(charts("Value format: unit1\n").value_format).toBe("1");
});

test("the chart grid is off by default and reads its lines and tick labels", () => {
  expect(parseTheme("").charts.grid).toEqual({
    axis_labels: false,
    ticks: 4,
    horizontal: false,
    vertical: false,
    color: 0xffd0d0d0,
    width: 1,
    dash: [],
    text: null,
  });
  const grid = charts(
    "### Chart Grid\nAxis labels: yes\nHorizontal lines: yes\nVertical lines: true\n" +
      "Line color: #ABCDEF\nLine width: 2\nLine dash: 4 3\nTicks: 6.9\n- Font size: 11\n",
  ).grid;
  expect(grid).toMatchObject({
    axis_labels: true,
    horizontal: true,
    vertical: true,
    color: 0xffabcdef,
    width: 2,
    dash: [4, 3],
    ticks: 6,
  });
  expect(grid.text?.font_size).toBe(11);
});

test("grid ticks clamp to 1..20 and a dash with a non-positive length draws solid", () => {
  const grid = (text: string) => charts(`### Chart Grid\n${text}`).grid;
  expect(grid("Ticks: 50\n").ticks).toBe(20);
  expect(grid("Ticks: 0\n").ticks).toBe(1);
  expect(grid("Ticks: inf\n").ticks).toBe(4);
  expect(grid("Line dash: 4 0\n").dash).toEqual([]);
  expect(grid("Line dash: 4 x\n").dash).toEqual([]);
  expect(grid("Line width: -1\n").width).toBe(0);
});

// md2ui line_chart_tests: test_a_theme_styles_the_line (on with no theme)
test("a theme styles the line chart, and Enabled: no turns it off", () => {
  expect(parseTheme("").charts.line.enabled).toBe(true);
  const line = charts(
    "### Line Chart\nHeight: 60\nLine width: 3\nLine color: #123456\nPoint size: 0\nPoints: last\n",
  ).line;
  expect(line).toEqual({
    enabled: true,
    height: 60,
    group_height: null,
    width: 3,
    color: 0xff123456,
    point_size: 0,
    points: "last",
  });
  expect(charts("### Line Chart\nEnabled: no\n").line.enabled).toBe(false);
});

test("line sizes floor, and an unreadable group height takes the height", () => {
  const line = (text: string) => charts(`### Line Chart\n${text}`).line;
  expect(line("Height: 2\nLine width: 0.1\nPoint size: -3\n")).toMatchObject({
    height: 8,
    width: 0.5,
    point_size: 0,
  });
  expect(line("Height: 70\nGroup height: tall\n").group_height).toBe(70);
  expect(line("Group height: 112\n").group_height).toBe(112);
  expect(line("Points: every\n").points).toBe("labelled");
});
