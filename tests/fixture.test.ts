import { existsSync } from "node:fs";
import { it, expect } from "vitest";

it("fixture suite ships maintenance guidance", () => {
  expect(existsSync(new URL("./fixtures/README.md", import.meta.url))).toBe(true);
});
