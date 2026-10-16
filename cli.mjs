#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      directory: { type: "string", short: "C" },
    },
  });
  if (values.version) {
    console.log(
      JSON.parse(await readFile(new URL("./package.json", import.meta.url)))
        .version,
    );
  } else if (values.help || positionals[0] === "help" || !positionals.length) {
    console.log(`Usage: bookorbit-plugin-tools <build|check-release|sign-release> [--directory PATH]

Run from a plugin repo containing src/index.ts, package.json and release.json.
  build          Bundle and validate dist/index.mjs; write dist/plugin.json.
  check-release  Check GitHub version/signature; set GITHUB_OUTPUT when provided.
  sign-release   Sign checked dist bytes using PLUGIN_SIGNING_KEY; never import plugin code.
  -C, --directory PATH  Plugin repo (default: current directory).
  -h, --help            Show help.
  -v, --version         Show tooling version.
Commands write build/release files only; publishing remains in the plugin workflow.`);
  } else {
    if (
      positionals.length !== 1 ||
      !["build", "check-release", "sign-release"].includes(positionals[0])
    )
      throw new Error("Unknown command. Use --help.");
    if (values.directory) process.chdir(values.directory);
    if (positionals[0] === "sign-release") {
      await (await import("./release.mjs")).signFiles();
    } else {
      await import(
        positionals[0] === "build" ? "./build.mjs" : "./check-release.mjs"
      );
    }
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Plugin tooling failed.",
  );
  process.exitCode = 1;
}
