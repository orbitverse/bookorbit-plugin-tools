import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateKeyPairSync, verify } from "node:crypto";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../cli.mjs", import.meta.url));

test("commands build, inspect, sign without execution and reconcile published bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "bookorbit-tools-"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const config = {
    repository: "owner/repo",
    type: "test-plugin",
    publicKey: publicKey.export({ format: "jwk" }).x,
  };
  const run = (command, env = {}, before = []) =>
    exec(process.execPath, [...before, cli, command, "--directory", root], {
      env: { PATH: process.env.PATH, ...env },
      timeout: 15000,
    });
  try {
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ version: "1.0.0", type: "module" }),
    );
    await writeFile(join(root, "LICENSE"), "Fixture project license");
    await writeFile(join(root, "NOTICE"), "Copyright Fixture Maintainer");
    for (const name of ["fixture-dep", "fixture-transitive", "unused-dep"]) {
      const dir = join(root, "node_modules", name);
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          name,
          version: "1.0.0",
          type: "module",
          main: "index.js",
        }),
      );
      await writeFile(
        join(dir, "LICENSE"),
        `Copyright ${name}\nPermission is hereby granted, free of charge.`,
      );
      await writeFile(
        join(dir, "index.js"),
        name === "fixture-dep"
          ? 'export { marker } from "fixture-transitive";'
          : 'export const marker = "fixture runtime";',
      );
    }
    await writeFile(join(root, "release.json"), JSON.stringify(config));
    const manifestUrl =
      "https://github.com/owner/repo/releases/latest/download/test-plugin.json";
    const source = `import { marker } from "fixture-dep"; export default {marker,apiVersion:1,type:"test-plugin",version:"1.0.0",update:${JSON.stringify({ manifestUrl, ed25519PublicKey: config.publicKey })},search(){},test(){},resolveFile(){}};`;
    await writeFile(join(root, "src/index.ts"), source);
    await run("build");
    const checked = await readFile(join(root, "dist/index.mjs"));
    const text = checked.toString();
    assert(text.includes("Copyright Fixture Maintainer"));
    assert(text.includes("Fixture project license"));
    assert(text.includes("Copyright fixture-dep"));
    assert(text.includes("Copyright fixture-transitive"));
    assert(!text.includes("Copyright unused-dep"));
    assert(text.includes("https://github.com/owner/repo/tree/v1.0.0"));
    // A missing license must fail rather than silently create an incomplete distribution.
    await rm(join(root, "node_modules/fixture-dep/LICENSE"));
    await assert.rejects(run("build"), /Missing license/);
    await writeFile(
      join(root, "node_modules/fixture-dep/LICENSE"),
      "Copyright fixture-dep",
    );
    // The signer must never execute the checked plugin, even with a key in its environment.
    await writeFile(
      join(root, "dist/index.mjs"),
      'throw Error("plugin executed in signing job");',
    );
    await run("sign-release", {
      PLUGIN_SIGNING_KEY: privateKey.export({ type: "pkcs8", format: "pem" }),
    });
    const manifest = JSON.parse(
      await readFile(join(root, "dist/test-plugin.json")),
    );
    const signed = await readFile(join(root, "dist/index.mjs"));
    assert(
      verify(
        null,
        signed,
        publicKey,
        Buffer.from(manifest.signature, "base64"),
      ),
    );
    assert.equal(
      await readFile(join(root, "dist/SHA256SUMS"), "utf8"),
      `${manifest.sha256}  index.mjs\n`,
    );
    const mock = join(root, "github-fixture.mjs");
    await writeFile(
      mock,
      `import {readFile} from 'node:fs/promises';
globalThis.fetch = async (url) => new Response(JSON.stringify(String(url).endsWith('.json') ? JSON.parse(await readFile(${JSON.stringify(join(root, "dist/test-plugin.json"))})) : {tag_name:'v1.0.0',draft:false,assets:[{name:'test-plugin.json',browser_download_url:'https://fixture.invalid/manifest.json'}]}), {status:200});`,
    );
    const output = join(root, "outputs");
    await run("check-release", { GITHUB_OUTPUT: output }, ["--import", mock]);
    assert.match(
      await readFile(output, "utf8"),
      /release=false\nversion=1.0.0/,
    );
    await writeFile(join(root, "dist/index.mjs"), checked);
    await assert.rejects(
      run("check-release", {}, ["--import", mock]),
      /Plugin changed since this version was published/,
    );
    await writeFile(
      join(root, "src/index.ts"),
      source.replace('version:"1.0.0"', 'version:"0.0.0"'),
    );
    await assert.rejects(run("build"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI help/version work without a plugin repo; unknown commands fail", async () => {
  assert.match(
    (await exec(process.execPath, [cli, "--help"])).stdout,
    /check-release/,
  );
  assert.match(
    (await exec(process.execPath, [cli, "--version"])).stdout,
    /^0.1.1\n$/,
  );
  await assert.rejects(
    exec(process.execPath, [cli, "publish"]),
    /Unknown command/,
  );
});
