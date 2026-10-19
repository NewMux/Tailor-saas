/** Dev-only Vite plugins must not be part of production builds. */
import { describe, expect, it } from "vitest";
import config from "../vite.config";

async function pluginNames(command: "build" | "serve") {
  const resolved = typeof config === "function" ? await config({ command, mode: command === "build" ? "production" : "development" }) : config;
  return (resolved.plugins ?? []).flat().map(plugin => (plugin && typeof plugin === "object" && "name" in plugin ? String(plugin.name) : ""));
}

describe("vite config", () => {
  it("omits the Manus runtime and jsx-loc from production builds", async () => {
    const names = (await pluginNames("build")).join(",");
    expect(names).not.toMatch(/manus/i);
    expect(names).not.toMatch(/jsx-loc/i);
  });

  it("keeps them for the dev server", async () => {
    const names = (await pluginNames("serve")).join(",");
    expect(names).toMatch(/manus/i);
  });
});
