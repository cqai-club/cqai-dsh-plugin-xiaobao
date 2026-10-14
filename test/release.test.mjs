/** Release tests mock every network call and publication; all bytes live in temporary files. */
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  PACKAGE_NAME, REPOSITORY, REGISTRY, assertNpmVersion, assertPublishEnvironment, assertRegistryIntegrity,
  integrityOf, readRegistryVersion, sha256Of, validateArchivePaths, validateManifest, waitForRegistry,
} from "../scripts/release-utils.mjs";
import { githubClient, reconcileGitHubRelease, releasePackage as publishPackage, requireTagAtCommit } from "../scripts/release-publish.mjs";

// Mock publication output must not look like evidence of a real npm/GitHub release.
const releasePackage = (options) => publishPackage({ logger: { log() {} }, ...options });

const HEAD = "a".repeat(40);
const manifest = (patch = {}) => ({ name: PACKAGE_NAME, version: "0.2.0", publishConfig: { access: "public", registry: `${REGISTRY}/` }, ...patch });
const environment = (patch = {}) => ({
  GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: REPOSITORY, GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main", GITHUB_SHA: HEAD,
  GITHUB_TOKEN: "test-placeholder", ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.invalid/oidc", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-placeholder", ...patch,
});

function fakeGithub({ reference, release, assets = [] } = {}) {
  const calls = [];
  const state = { reference, release, assets, uploads: 0 };
  return {
    calls, state,
    async request(method, path, body) {
      calls.push({ method, path, body });
      if (method === "GET" && path.startsWith("/git/ref/tags/")) return state.reference;
      if (method === "POST" && path === "/git/refs") {
        state.reference = { object: { type: "commit", sha: body.sha } };
        return state.reference;
      }
      if (method === "GET" && path.startsWith("/releases/tags/")) return state.release;
      if (method === "POST" && path === "/releases") {
        state.release = { ...body, id: 10, html_url: `https://github.com/${REPOSITORY}/releases/tag/${body.tag_name}`, upload_url: `https://uploads.github.com/repos/${REPOSITORY}/releases/10/assets{?name,label}` };
        return state.release;
      }
      if (method === "GET" && path.startsWith("/releases/10/assets?")) return state.assets;
      if (method === "PATCH" && path === "/releases/10") {
        state.release = { ...state.release, ...body };
        return state.release;
      }
      throw new Error(`Unexpected fake GitHub operation ${method} ${path}`);
    },
    async upload(_release, filename, bytes) {
      state.uploads += 1;
      state.assets.push({ id: 20, name: filename, size: bytes.length, digest: `sha256:${sha256Of(bytes)}` });
      return state.assets.at(-1);
    },
    async download() { throw new Error("This fixture should verify its asset digest directly"); },
  };
}

async function fixture(t, version = "0.2.0") {
  const root = await mkdtemp(join(tmpdir(), "xiaobao-release-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from("isolated test archive bytes");
  const artifact = { ...validateManifest(manifest({ version })), filename: `cqaiclub-cqai-dsh-plugin-xiaobao-${version}.tgz`, tarball: join(root, "package.tgz"), integrity: integrityOf(bytes) };
  await writeFile(artifact.tarball, bytes);
  const metadata = { name: artifact.name, version: artifact.version, gitHead: "b".repeat(40), dist: { integrity: artifact.integrity, tarball: `${REGISTRY}/fixture/-/archive.tgz` } };
  return { artifact, metadata, bytes };
}

test("release manifest rejects wrong scope, reused invalid versions and install dependencies", () => {
  assert.equal(validateManifest(manifest()).tag, "v0.2.0");
  assert.equal(validateManifest(manifest({ version: "0.2.0-beta.1" })).prerelease, true);
  for (const patch of [{ name: "cqai-dsh-plugin-xiaobao" }, { version: "0.02.0" }, { version: "0.2.0+build" }, { version: "0.2.0-beta.01" }, { private: true }, { dependencies: { external: "*" } }, { publishConfig: { access: "restricted", registry: REGISTRY } }]) {
    assert.throws(() => validateManifest(manifest(patch)));
  }
});

test("trusted release runner requires its own commit, publish branch and OIDC capability", () => {
  assert.doesNotThrow(() => assertPublishEnvironment(environment(), HEAD, "24.0.0"));
  assert.doesNotThrow(() => assertPublishEnvironment(environment({ GITHUB_REF: "refs/heads/master", GITHUB_EVENT_NAME: "workflow_dispatch" }), HEAD, "24.0.0"));
  for (const patch of [{ GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_REF: "refs/heads/feature" }, { GITHUB_SHA: "b".repeat(40) }, { RUNNER_ENVIRONMENT: "self-hosted" }, { ACTIONS_ID_TOKEN_REQUEST_TOKEN: "" }, { GITHUB_REPOSITORY: "other/repo" }]) {
    assert.throws(() => assertPublishEnvironment(environment(patch), HEAD, "24.0.0"));
  }
  assert.throws(() => assertPublishEnvironment(environment(), HEAD, "22.19.0"));
});

test("npm version gate respects semver components", () => {
  for (const version of ["11.5.1", "11.16.0", "12.0.0"]) assert.doesNotThrow(() => assertNpmVersion(version));
  for (const version of ["10.99.99", "11.4.99", "11.5.0", "unknown"]) assert.throws(() => assertNpmVersion(version));
});

test("archive checks reject traversal and a tarball that omitted its selfcheck", () => {
  const files = ["package/package.json", "package/scripts/selfcheck.mjs", "package/lib/index.js", "package/lib/client.js"];
  assert.doesNotThrow(() => validateArchivePaths(files));
  assert.throws(() => validateArchivePaths(files.filter((file) => !file.includes("selfcheck"))));
  for (const path of ["../outside", "/package/absolute", "package/sub/../../outside", "package\\outside"]) assert.throws(() => validateArchivePaths([...files, path]));
});

test("only registry HTTP 404 means a missing version", async () => {
  assert.equal(await readRegistryVersion(PACKAGE_NAME, "0.2.0", async () => new Response("", { status: 404 })), undefined);
  for (const status of [401, 403, 429, 500, 503]) {
    await assert.rejects(() => readRegistryVersion(PACKAGE_NAME, "0.2.0", async () => new Response("", { status })), /publication state is unknown/);
  }
  await assert.rejects(() => readRegistryVersion(PACKAGE_NAME, "0.2.0", async () => { throw new Error("network failed"); }), /network failed/);
  await assert.rejects(() => readRegistryVersion(PACKAGE_NAME, "0.2.0", async () => Response.json({ name: "another", version: "0.2.0" })), /different package/);
});

test("registry proof rejects different tarball bytes and an external tarball origin", async (t) => {
  const { artifact, metadata, bytes } = await fixture(t);
  assert.equal(assertRegistryIntegrity(metadata, artifact), metadata.dist.tarball);
  assert.throws(() => assertRegistryIntegrity({ ...metadata, dist: { ...metadata.dist, integrity: integrityOf(Buffer.from("different")) } }, artifact), /different or unverifiable/);
  assert.throws(() => assertRegistryIntegrity({ ...metadata, dist: { ...metadata.dist, tarball: "https://example.invalid/package.tgz" } }, artifact), /outside/);
  let count = 0;
  const proved = await waitForRegistry(artifact, { sleep: async () => {}, fetchImpl: async (url) => {
    if (url === metadata.dist.tarball) return new Response(bytes);
    count += 1;
    return count === 1 ? new Response("", { status: 404 }) : Response.json(metadata);
  } });
  assert.equal(proved.version, artifact.version);
  await assert.rejects(() => waitForRegistry(artifact, { sleep: async () => {}, fetchImpl: async (url) => url === metadata.dist.tarball ? new Response("wrong bytes") : Response.json(metadata) }), /does not match/);
});

test("annotated version tags are peeled and conflicting commits are never replaced", async () => {
  const calls = [];
  const api = { async request(method, path) {
    calls.push({ method, path });
    return path.startsWith("/git/ref/") ? { object: { type: "tag", sha: "annotated" } } : { object: { type: "commit", sha: HEAD } };
  } };
  assert.equal(await requireTagAtCommit(api, "v0.2.0", HEAD), true);
  assert.ok(calls.some((call) => call.path === "/git/tags/annotated"));
  const conflict = fakeGithub({ reference: { object: { type: "commit", sha: "b".repeat(40) } } });
  await assert.rejects(() => requireTagAtCommit(conflict, "v0.2.0", HEAD, { create: true }), /another commit/);
  assert.equal(conflict.calls.filter((call) => call.method !== "GET").length, 0);
});

test("tag creation races re-read and validate the winner's commit", async () => {
  let reads = 0;
  const api = { async request(method) {
    if (method === "GET") return ++reads === 1 ? undefined : { object: { type: "commit", sha: HEAD } };
    const error = new Error("already exists"); error.status = 422; throw error;
  } };
  assert.equal(await requireTagAtCommit(api, "v0.2.0", HEAD, { create: true }), true);
});

test("GitHub release is uploaded before publication and can be reconciled twice", async (t) => {
  const { artifact, metadata } = await fixture(t);
  const api = fakeGithub();
  const first = await reconcileGitHubRelease(api, { artifact, head: HEAD, metadata });
  assert.equal(first.draft, false);
  assert.equal(api.state.uploads, 1);
  const second = await reconcileGitHubRelease(api, { artifact, head: HEAD, metadata });
  assert.equal(second.id, first.id);
  assert.equal(api.state.uploads, 1, "rerun must not replace an already verified asset");
  assert.equal(api.calls.filter((call) => call.method === "POST" && call.path === "/releases").length, 1);
});

test("an existing GitHub archive with different bytes is not clobbered", async (t) => {
  const { artifact, metadata, bytes } = await fixture(t);
  const api = fakeGithub({ reference: { object: { type: "commit", sha: HEAD } }, release: { id: 10, tag_name: artifact.tag, draft: false }, assets: [{ name: artifact.filename, size: bytes.length, digest: "sha256:wrong" }] });
  await assert.rejects(() => reconcileGitHubRelease(api, { artifact, head: HEAD, metadata }), /different bytes/);
  assert.equal(api.state.uploads, 0);
  assert.equal(api.calls.filter((call) => call.method !== "GET").length, 0);
});

test("legacy GitHub assets without a digest are downloaded and checked before skip", async (t) => {
  const { artifact, metadata, bytes } = await fixture(t);
  const api = fakeGithub({ reference: { object: { type: "commit", sha: HEAD } }, release: { id: 10, tag_name: artifact.tag, draft: false }, assets: [{ name: artifact.filename, size: bytes.length, id: 20 }] });
  let downloads = 0;
  api.download = async () => { downloads += 1; return bytes; };
  await reconcileGitHubRelease(api, { artifact, head: HEAD, metadata });
  assert.equal(downloads, 1);
  assert.equal(api.state.uploads, 0);
});

test("an upload with corrupt bytes leaves the release draft for a later repair", async (t) => {
  const { artifact, metadata, bytes } = await fixture(t);
  const api = fakeGithub();
  api.upload = async (_release, name) => ({ name, size: bytes.length, digest: "sha256:wrong" });
  await assert.rejects(() => reconcileGitHubRelease(api, { artifact, head: HEAD, metadata }), /does not match/);
  assert.equal(api.state.release.draft, true);
});

test("GitHub API failures are not treated as missing releases", async () => {
  const api = githubClient({ token: "test-placeholder", fetchImpl: async () => new Response("", { status: 503 }) });
  await assert.rejects(() => api.request("GET", "/releases/tags/v0.2.0"), /HTTP 503/);
});

test("published npm version skips publication and repairs its GitHub release", async (t) => {
  const { artifact, metadata, bytes } = await fixture(t);
  const commands = [];
  const api = fakeGithub();
  const result = await releasePackage({ env: environment(), nodeVersion: "24.0.0", api, pack: async () => artifact,
    run: async (command, args) => { commands.push([command, ...args]); return command === "git" ? HEAD : "11.16.0"; },
    fetchImpl: async (url) => url === metadata.dist.tarball ? new Response(bytes) : Response.json(metadata),
  });
  assert.equal(result.npmPublishedNow, false);
  assert.equal(commands.some((command) => command[1] === "publish"), false);
  assert.equal(api.state.uploads, 1);
});

test("an unchanged package on a later merge keeps its completed release and original tag", async (t) => {
  const { artifact, metadata, bytes } = await fixture(t);
  const commands = [];
  const api = fakeGithub({
    reference: { object: { type: "commit", sha: "b".repeat(40) } },
    release: { id: 10, tag_name: artifact.tag, draft: false, html_url: "https://github.com/fixture/release" },
    assets: [{ id: 20, name: artifact.filename, size: bytes.length, digest: `sha256:${sha256Of(bytes)}` }],
  });
  const result = await releasePackage({ env: environment(), nodeVersion: "24.0.0", api, pack: async () => artifact,
    run: async (command, args) => { commands.push([command, ...args]); return command === "git" ? HEAD : "11.16.0"; },
    fetchImpl: async (url) => url === metadata.dist.tarball ? new Response(bytes) : Response.json(metadata),
  });
  assert.equal(result.npmPublishedNow, false);
  assert.equal(commands.some((command) => command[1] === "publish"), false);
  assert.equal(api.calls.filter((call) => call.method !== "GET").length, 0);
  assert.equal(api.state.reference.object.sha, "b".repeat(40));
});

test("another commit's incomplete release cannot be repaired with this checkout", async (t) => {
  const { artifact, metadata } = await fixture(t);
  for (const release of [undefined, { id: 10, tag_name: artifact.tag, draft: false }, { id: 10, tag_name: artifact.tag, draft: true }]) {
    const api = fakeGithub({ reference: { object: { type: "commit", sha: "b".repeat(40) } }, release });
    await assert.rejects(() => reconcileGitHubRelease(api, { artifact, head: HEAD, metadata }), /another commit/);
    assert.equal(api.calls.filter((call) => call.method !== "GET").length, 0);
    assert.equal(api.state.uploads, 0);
  }
});

test("missing npm version publishes only the verified tarball then proves registry bytes", async (t) => {
  const { artifact, metadata, bytes } = await fixture(t);
  const commands = [];
  let visible = false;
  const result = await releasePackage({ env: environment(), nodeVersion: "24.0.0", api: fakeGithub(), pack: async () => artifact, sleep: async () => {},
    run: async (command, args) => {
      commands.push([command, ...args]);
      if (command === "git") return HEAD;
      if (args[0] === "--version") return "11.16.0";
      assert.equal(args[0], "publish"); visible = true; return "mock published";
    },
    fetchImpl: async (url) => url === metadata.dist.tarball ? new Response(bytes) : visible ? Response.json(metadata) : new Response("", { status: 404 }),
  });
  assert.equal(result.npmPublishedNow, true);
  const publish = commands.find((command) => command[1] === "publish");
  assert.equal(publish[2], artifact.tarball);
  assert.ok(publish.includes("--provenance"));
  assert.ok(publish.includes("--ignore-scripts"));
  assert.equal(publish[publish.indexOf("--tag") + 1], "latest");
});

test("prerelease publication uses next without moving the stable npm tag", async (t) => {
  const { artifact, metadata, bytes } = await fixture(t, "0.2.1-beta.1");
  const commands = [];
  let visible = false;
  await releasePackage({ env: environment(), nodeVersion: "24.0.0", api: fakeGithub(), pack: async () => artifact, sleep: async () => {},
    run: async (command, args) => {
      commands.push([command, ...args]);
      if (command === "git") return HEAD;
      if (args[0] === "--version") return "11.16.0";
      visible = true; return "mock published";
    },
    fetchImpl: async (url) => url === metadata.dist.tarball ? new Response(bytes) : visible ? Response.json(metadata) : new Response("", { status: 404 }),
  });
  const publish = commands.find((command) => command[1] === "publish");
  assert.equal(publish[publish.indexOf("--tag") + 1], "next");
});

test("registry uncertainty or conflicting tag stops before npm or GitHub writes", async (t) => {
  const { artifact } = await fixture(t);
  for (const conflict of [false, true]) {
    const commands = [];
    const api = fakeGithub({ reference: conflict ? { object: { type: "commit", sha: "b".repeat(40) } } : undefined });
    await assert.rejects(() => releasePackage({ env: environment(), nodeVersion: "24.0.0", api, pack: async () => artifact,
      run: async (command, args) => { commands.push([command, ...args]); return command === "git" ? HEAD : "11.16.0"; },
      fetchImpl: async () => new Response("", { status: 503 }),
    }));
    assert.equal(commands.some((command) => command[1] === "publish"), false);
    assert.equal(api.calls.filter((call) => call.method !== "GET").length, 0);
  }
});

test("a missing npm version with a conflicting tag cannot publish", async (t) => {
  const { artifact } = await fixture(t);
  const commands = [];
  const api = fakeGithub({ reference: { object: { type: "commit", sha: "b".repeat(40) } } });
  await assert.rejects(() => releasePackage({ env: environment(), nodeVersion: "24.0.0", api, pack: async () => artifact,
    run: async (command, args) => { commands.push([command, ...args]); return command === "git" ? HEAD : "11.16.0"; },
    fetchImpl: async () => new Response("", { status: 404 }),
  }), /another commit/);
  assert.equal(commands.some((command) => command[1] === "publish"), false);
  assert.equal(api.calls.filter((call) => call.method !== "GET").length, 0);
});

test("an already published version with different package bytes cannot mutate its release", async (t) => {
  const { artifact, metadata } = await fixture(t);
  const commands = [];
  const api = fakeGithub();
  await assert.rejects(() => releasePackage({ env: environment(), nodeVersion: "24.0.0", api, pack: async () => artifact,
    run: async (command, args) => { commands.push([command, ...args]); return command === "git" ? HEAD : "11.16.0"; },
    fetchImpl: async () => Response.json({ ...metadata, dist: { ...metadata.dist, integrity: "sha512:different" } }),
  }), /bump the package version/);
  assert.equal(commands.some((command) => command[1] === "publish"), false);
  assert.equal(api.calls.filter((call) => call.method !== "GET").length, 0);
});
