import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, createHash, verify } from "node:crypto";
import { signRelease } from "../release.mjs";

test("release signature covers the exact bundle and rejects tampered bytes", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const key = publicKey.export({ format: "jwk" }).x;
  const source = Buffer.from("export default {};");
  const descriptor = {
    type: "test-plugin",
    version: "1.0.0",
    update: { ed25519PublicKey: key },
  };
  const config = {
    type: "test-plugin",
    repository: "owner/repo",
    publicKey: key,
  };
  const manifest = signRelease(
    source,
    descriptor,
    privateKey.export({ type: "pkcs8", format: "pem" }),
    config,
  );
  assert.equal(
    manifest.sha256,
    createHash("sha256").update(source).digest("hex"),
  );
  assert.equal(
    manifest.sourceUrl,
    "https://github.com/owner/repo/releases/download/v1.0.0/index.mjs",
  );
  assert(
    verify(null, source, publicKey, Buffer.from(manifest.signature, "base64")),
  );
  assert(
    !verify(
      null,
      Buffer.from("tampered"),
      publicKey,
      Buffer.from(manifest.signature, "base64"),
    ),
  );
  assert.throws(
    () =>
      signRelease(
        source,
        descriptor,
        privateKey.export({ type: "pkcs8", format: "pem" }),
        { ...config, publicKey: "incorrect" },
      ),
    /pinned public key/,
  );
});
