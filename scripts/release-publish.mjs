#!/usr/bin/env node
/** OIDC npm publication and idempotent GitHub Release reconciliation. */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildVerifiedPackage, runCommand } from "./release-pack.mjs";
import {
  REPOSITORY, REGISTRY, assertNpmVersion, assertPublishEnvironment, readRegistryVersion,
  sha256Of, verifyRegistryArtifact, waitForRegistry,
} from "./release-utils.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export function githubClient({ token, repository = REPOSITORY, fetchImpl = fetch }) {
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  const endpoint = `https://api.github.com/repos/${repository}`;
  return {
    async request(method, path, body) {
      const response = await fetchImpl(`${endpoint}${path}`, {
        method, headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: "error",
      });
      if (method === "GET" && response.status === 404) return undefined;
      if (!response.ok) {
        const error = new Error(`GitHub ${method} ${path} failed with HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return response.status === 204 ? undefined : response.json();
    },
    async upload(release, filename, bytes) {
      const url = new URL(release.upload_url.replace(/\{.*$/u, ""));
      if (url.origin !== "https://uploads.github.com" || !url.pathname.startsWith(`/repos/${repository}/releases/`)) throw new Error("GitHub returned an unexpected upload URL");
      url.searchParams.set("name", filename);
      const response = await fetchImpl(url, { method: "POST", headers: { ...headers, "content-type": "application/gzip" }, body: bytes, signal: AbortSignal.timeout(60000), redirect: "error" });
      if (!response.ok) throw new Error(`GitHub asset upload failed with HTTP ${response.status}`);
      return response.json();
    },
    async download(asset) {
      const response = await fetchImpl(`${endpoint}/releases/assets/${asset.id}`, { headers: { ...headers, accept: "application/octet-stream" }, signal: AbortSignal.timeout(30000), redirect: "follow" });
      if (!response.ok) throw new Error(`GitHub existing asset verification failed with HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

/** Peel annotated tags as well as lightweight tags without changing the ref. */
export async function readTagCommit(api, tag) {
  const reference = await api.request("GET", `/git/ref/tags/${encodeURIComponent(tag)}`);
  if (reference === undefined) return undefined;
  let object = reference.object;
  for (let depth = 0; object?.type === "tag" && depth < 10; depth += 1) {
    const annotated = await api.request("GET", `/git/tags/${object.sha}`);
    object = annotated?.object;
  }
  if (object?.type !== "commit") throw new Error(`Cannot resolve version tag ${tag} to a commit`);
  return object.sha;
}

/** New/repaired releases must point to this commit; never move a version tag. */
export async function requireTagAtCommit(api, tag, head, { create = false } = {}) {
  const path = `/git/ref/tags/${encodeURIComponent(tag)}`;
  let reference = await api.request("GET", path);
  if (reference === undefined && create) {
    try {
      await api.request("POST", "/git/refs", { ref: `refs/tags/${tag}`, sha: head });
    } catch (error) {
      // Another run may have created the tag after our read. Re-read, then apply
      // the same commit check rather than force-updating the existing ref.
      if (error.status !== 422) throw error;
    }
    reference = await api.request("GET", path);
    if (reference === undefined) throw new Error(`Version tag ${tag} was not created`);
  }
  if (reference === undefined) return false;
  const commit = reference.object?.type === "commit" ? reference.object.sha : await readTagCommit(api, tag);
  if (commit !== head) throw new Error(`Version tag ${tag} points to another commit; refusing to replace it`);
  return true;
}

export async function reconcileGitHubRelease(api, { artifact, head, metadata }) {
  const tagCommit = await readTagCommit(api, artifact.tag);
  const releasePath = `/releases/tags/${encodeURIComponent(artifact.tag)}`;
  let release = await api.request("GET", releasePath);
  const retainExisting = tagCommit !== undefined && tagCommit !== head;
  if (retainExisting && (release === undefined || release.draft === true)) throw new Error(`Version tag ${artifact.tag} belongs to another commit and has no completed release; refusing to repair it from this commit`);
  if (!retainExisting) await requireTagAtCommit(api, artifact.tag, head, { create: true });
  if (release === undefined) {
    const npmUrl = `https://www.npmjs.com/package/${artifact.name}/v/${artifact.version}`;
    try {
      release = await api.request("POST", "/releases", {
        tag_name: artifact.tag, target_commitish: head, name: `${artifact.name} ${artifact.tag}`,
        draft: true, prerelease: artifact.prerelease, generate_release_notes: true,
        body: `npm package: [${artifact.name}@${artifact.version}](${npmUrl})\n\nSource commit: ${head}\n\nVerified npm integrity: \`${metadata.dist.integrity}\``,
      });
    } catch (error) {
      if (error.status !== 422) throw error;
      release = await api.request("GET", releasePath);
      if (release === undefined) throw error;
    }
  }
  if (release.tag_name !== artifact.tag) throw new Error("GitHub Release is attached to a different version tag");
  if (!retainExisting) await requireTagAtCommit(api, artifact.tag, head);
  const bytes = await readFile(artifact.tarball);
  const expectedDigest = `sha256:${sha256Of(bytes)}`;
  let existing;
  for (let page = 1; page <= 20; page += 1) {
    const assets = await api.request("GET", `/releases/${release.id}/assets?per_page=100&page=${page}`);
    if (!Array.isArray(assets)) throw new Error("Cannot read the GitHub Release assets");
    existing = assets.find((asset) => asset.name === artifact.filename);
    if (existing || assets.length < 100) break;
    if (page === 20) throw new Error("GitHub Release asset listing exceeded its pagination bound");
  }
  if (existing !== undefined) {
    if (existing.size !== bytes.length) throw new Error("Existing GitHub archive has a different size; refusing to overwrite it");
    const digest = existing.digest ?? `sha256:${sha256Of(await api.download(existing))}`;
    if (digest !== expectedDigest) throw new Error("Existing GitHub archive has different bytes; refusing to overwrite it");
  } else {
    if (retainExisting) throw new Error("Existing version tag belongs to another commit and its release archive is missing; refusing to supplement it from this commit");
    const uploaded = await api.upload(release, artifact.filename, bytes);
    if (uploaded.name !== artifact.filename || uploaded.size !== bytes.length) throw new Error("Uploaded GitHub archive metadata differs from the verified package");
    const digest = uploaded.digest ?? `sha256:${sha256Of(await api.download(uploaded))}`;
    if (digest !== expectedDigest) throw new Error("Uploaded GitHub archive does not match the verified package bytes");
  }
  const finalCommit = await readTagCommit(api, artifact.tag);
  if (finalCommit !== (retainExisting ? tagCommit : head)) throw new Error("Version tag changed during release reconciliation; refusing to publish the release");
  // Upload to a draft first so an immutable release locks only after its archive exists.
  if (release.draft === true) release = await api.request("PATCH", `/releases/${release.id}`, { draft: false });
  return release;
}

export async function releasePackage({
  env = process.env, projectRoot = ROOT, outputRoot = join(env.RUNNER_TEMP ?? ROOT, "xiaobao-release"),
  pack = buildVerifiedPackage, run = runCommand, fetchImpl = fetch, sleep, api, nodeVersion = process.versions.node, logger = console,
} = {}) {
  const head = (await run("git", ["rev-parse", "HEAD"], { cwd: projectRoot })).trim();
  assertPublishEnvironment(env, head, nodeVersion);
  assertNpmVersion(await run("npm", ["--version"], { cwd: projectRoot }));
  const artifact = await pack({ projectRoot, outputRoot, run });
  const github = api ?? githubClient({ token: env.GITHUB_TOKEN, fetchImpl });
  // Registry failures and any tag conflict for a new version fail before publication.
  let metadata = await readRegistryVersion(artifact.name, artifact.version, fetchImpl);
  const skipped = metadata !== undefined;
  if (skipped) {
    await verifyRegistryArtifact(metadata, artifact, fetchImpl);
    logger.log(`npm already contains the verified ${artifact.name}@${artifact.version}; skipping publication`);
  } else {
    await requireTagAtCommit(github, artifact.tag, head);
    logger.log(await run("npm", ["publish", artifact.tarball, "--access", "public", "--tag", artifact.prerelease ? "next" : "latest", "--registry", REGISTRY, "--provenance", "--ignore-scripts"], { cwd: projectRoot }));
    metadata = await waitForRegistry(artifact, { fetchImpl, ...(sleep === undefined ? {} : { sleep }) });
  }
  const release = await reconcileGitHubRelease(github, { artifact, head, metadata });
  const result = { package: artifact.name, version: artifact.version, commit: head, npmPublishedNow: !skipped, integrity: metadata.dist.integrity, githubRelease: release.html_url };
  logger.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await releasePackage();
