/** Shared release boundaries. Imports are read-only; publication belongs to the CLI. */
import { createHash } from "node:crypto";

export const PACKAGE_NAME = "@cqaiclub/cqai-dsh-plugin-xiaobao";
export const REPOSITORY = "cqai-club/cqai-dsh-plugin-xiaobao";
export const REGISTRY = "https://registry.npmjs.org";
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

export function validateManifest(manifest) {
  if (manifest.name !== PACKAGE_NAME) throw new Error(`Release package must be ${PACKAGE_NAME}`);
  if (!VERSION.test(manifest.version ?? "")) throw new Error("Release version must be a canonical semver without build metadata");
  const identifiers = manifest.version.split("-").slice(1).join("-").split(".");
  if (identifiers.some((id) => /^0\d+$/u.test(id))) throw new Error("Numeric prerelease identifiers cannot have leading zeroes");
  if (manifest.private === true) throw new Error("Cannot release a private package");
  if (Object.keys(manifest.dependencies ?? {}).length > 0) throw new Error("The offline release workflow requires a zero-dependency package");
  if (manifest.publishConfig?.access !== "public") throw new Error("Scoped package releases must explicitly declare public access");
  if ((manifest.publishConfig?.registry ?? "").replace(/\/$/u, "") !== REGISTRY) throw new Error("Release registry must be registry.npmjs.org");
  return { name: manifest.name, version: manifest.version, tag: `v${manifest.version}`, prerelease: manifest.version.includes("-") };
}

export function integrityOf(bytes) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

export function sha256Of(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateArchivePaths(paths) {
  if (paths.length === 0) throw new Error("npm archive is empty");
  for (const path of paths) {
    const segments = path.split("/");
    if (!path.startsWith("package/") || segments.includes("..") || path.includes("\\") || path.includes("\0")) {
      throw new Error(`Archive entry escapes its package root: ${JSON.stringify(path)}`);
    }
  }
  for (const required of ["package/package.json", "package/scripts/selfcheck.mjs", "package/lib/index.js", "package/lib/client.js"]) {
    if (!paths.includes(required)) throw new Error(`npm archive is missing ${required}`);
  }
}

export function assertNpmVersion(version) {
  const parsed = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version.trim());
  if (parsed === null) throw new Error("Cannot determine the npm version");
  const parts = parsed.slice(1).map(Number);
  const minimum = [11, 5, 1];
  for (let index = 0; index < 3; index += 1) {
    if (parts[index] > minimum[index]) return;
    if (parts[index] < minimum[index]) throw new Error("Trusted publishing requires npm >= 11.5.1");
  }
}

export function assertPublishEnvironment(env, head, nodeVersion = process.versions.node) {
  if (Number(nodeVersion.split(".")[0]) < 24) throw new Error("Release publication requires Node.js 24 or newer");
  if (env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted") throw new Error("Publication is restricted to GitHub-hosted Actions runners");
  if (env.GITHUB_SERVER_URL !== "https://github.com" || env.GITHUB_REPOSITORY !== REPOSITORY) throw new Error("Publication repository does not match the trusted publisher");
  if (!["push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME)) throw new Error("Pull request events cannot publish");
  if (!["refs/heads/main", "refs/heads/master"].includes(env.GITHUB_REF)) throw new Error("Only main and master can publish");
  if (!/^[a-f0-9]{40}$/u.test(head) || env.GITHUB_SHA !== head) throw new Error("Checked-out HEAD does not match the workflow commit");
  for (const key of ["GITHUB_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "ACTIONS_ID_TOKEN_REQUEST_TOKEN"]) {
    if (!env[key]) throw new Error(`Release runner is missing ${key}`);
  }
}

/** Only an actual 404 means this exact version has not been published. */
export async function readRegistryVersion(name, version, fetchImpl = fetch) {
  const url = `${REGISTRY}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(15000), headers: { accept: "application/json" } });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`npm registry lookup failed with HTTP ${response.status}; publication state is unknown`);
  const metadata = await response.json();
  if (metadata.name !== name || metadata.version !== version) throw new Error("npm registry returned a different package or version");
  return metadata;
}

export function assertRegistryIntegrity(metadata, artifact) {
  if (metadata.name !== artifact.name || metadata.version !== artifact.version) throw new Error("Published package identity does not match the verified archive");
  if (!metadata.dist?.integrity || metadata.dist.integrity !== artifact.integrity) {
    throw new Error("This npm version already contains different or unverifiable bytes; bump the package version instead of reusing it");
  }
  const tarball = new URL(metadata.dist.tarball);
  if (tarball.origin !== REGISTRY) throw new Error("Published tarball is outside the npm registry");
  return tarball.href;
}

export async function verifyRegistryArtifact(metadata, artifact, fetchImpl = fetch) {
  const url = assertRegistryIntegrity(metadata, artifact);
  const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Published tarball verification failed with HTTP ${response.status}`);
  if (integrityOf(Buffer.from(await response.arrayBuffer())) !== artifact.integrity) throw new Error("Published npm tarball does not match the verified local archive");
}

export async function waitForRegistry(artifact, { fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), attempts = 8 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const metadata = await readRegistryVersion(artifact.name, artifact.version, fetchImpl);
    if (metadata !== undefined) {
      await verifyRegistryArtifact(metadata, artifact, fetchImpl);
      return metadata;
    }
    if (attempt + 1 < attempts) await sleep(1000 * (attempt + 1));
  }
  throw new Error("Publish returned but npm has not exposed the version yet; rerun the workflow to reconcile it without republishing");
}
