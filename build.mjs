import { build } from "esbuild";
import assert from "node:assert/strict";
import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const result = await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  minify: true,
  legalComments: "eof",
  metafile: true,
});
const packageInfo = JSON.parse(await readFile("package.json", "utf8"));
const config = JSON.parse(await readFile("release.json", "utf8"));
const roots = new Set(["."]);
for (const input of Object.keys(result.metafile.inputs)) {
  const root = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1];
  if (root) roots.add(root);
}
const notices = [
  `Corresponding source and build instructions: https://github.com/${config.repository}/tree/v${packageInfo.version}`,
];
for (const root of [...roots].sort()) {
  const metadata = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
  );
  const names = (await readdir(root))
    .filter((name) => /^(?:licen[cs]e|notice)(?:[.-].*)?$/i.test(name))
    .sort();
  // boolbase's npm archive omits its upstream ISC license.
  const supplemental =
    metadata.name === "boolbase" && metadata.version === "1.0.0"
      ? await readFile(
          new URL("./licenses/boolbase@1.0.0.txt", import.meta.url),
          "utf8",
        )
      : undefined;
  assert(
    names.some((name) => /^licen[cs]e/i.test(name)) || supplemental,
    `Missing license: ${root}`,
  );
  notices.push(`${metadata.name ?? config.type} ${metadata.version}`);
  if (supplemental) notices.push(supplemental);
  for (const name of names)
    notices.push(await readFile(resolve(root, name), "utf8"));
}
// Keep licenses shipped as separate files inside every standalone download, too.
await appendFile(
  "dist/index.mjs",
  `\n/*\n${notices.join("\n\n").replaceAll("*/", "* /")}\n*/\n`,
);
const bytes = (await readFile("dist/index.mjs")).byteLength;
assert(
  bytes <= 512 * 1024,
  `Plugin is ${bytes} bytes; BookOrbit allows at most 524288`,
);

// Same isolated import, deadline, output cap and stripped environment as BookOrbit's inspector.
const inspect = `
const { pathToFileURL } = await import('node:url');
const { default: plugin } = await import(pathToFileURL(process.argv[1]).href);
process.stdout.write(JSON.stringify({apiVersion:plugin.apiVersion,type:plugin.type,version:plugin.version,update:plugin.update,hasSearch:typeof plugin.search==='function',hasTest:typeof plugin.test==='function',hasResolveFile:typeof plugin.resolveFile==='function'}));
`;
const { stdout } = await promisify(execFile)(
  process.execPath,
  ["--input-type=module", "-e", inspect, resolve("dist/index.mjs")],
  {
    timeout: 5000,
    maxBuffer: 64 * 1024,
    env: { PATH: process.env.PATH ?? "" },
  },
);
const plugin = JSON.parse(stdout);
assert.equal(plugin.apiVersion, 1);
assert.match(plugin.type, /^[a-z0-9][a-z0-9-]{0,29}$/);
assert(
  plugin.hasSearch && plugin.hasTest && plugin.hasResolveFile,
  "Bundle must expose BookOrbit's search, test and resolveFile methods",
);
assert.equal(plugin.version, packageInfo.version);
assert.match(plugin.update.ed25519PublicKey, /^[A-Za-z0-9_-]{43}$/);
assert.equal(new URL(plugin.update.manifestUrl).protocol, "https:");
await writeFile("dist/plugin.json", JSON.stringify(plugin, null, 2) + "\n");
console.log(
  `BookOrbit upload checks passed: ${bytes}/524288 bytes, isolated import succeeded (${plugin.version}).`,
);
