import { spawnSync } from "node:child_process";
import { test, expect } from "vitest";

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

test("npm test passes", () => {
  const result = spawnSync(npmCommand(), ["test"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });

  expect(
    result.status,
    `npm test failed\nSTDOUT:\n${result.stdout ?? ""}\nSTDERR:\n${result.stderr ?? ""}`,
  ).toBe(0);
});
