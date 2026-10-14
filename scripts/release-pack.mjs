#!/usr/bin/env node
/** Verify source, pack once, and run the same offline checks from the extracted artifact. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { integrityOf, validateArchivePaths, validateManifest } from "./release-utils.mjs";

const execute = promisify(execFile);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export async function runCommand(command, args, { cwd = ROOT, env = process.env } = {}) {
  try {
    const result = await execute(command, args, { cwd, env, maxBuffer: 16 * 1024 * 1024 });
    return result.stdout;
  } catch (error) {
    throw new Error(`${command} ${args[0] ?? ""} failed: ${error.stderr || error.stdout || error.message}`, { cause: error });
  }
}

export async function buildVerifiedPackage({ projectRoot = ROOT, outputRoot, run = runCommand } = {}) {
  const root = resolve(projectRoot);
  const output = outputRoot === undefined ? await mkdtemp(join(tmpdir(), "xiaobao-release-")) : resolve(outputRoot);
  await mkdir(output, { recursive: true });
  const packageInfo = validateManifest(JSON.parse(await readFile(join(root, "package.json"), "utf8")));
  console.log(await run(process.execPath, [join(root, "scripts", "selfcheck.mjs")], { cwd: root }));
  const packed = JSON.parse(await run("npm", ["pack", "--json", "--offline", "--ignore-scripts", "--pack-destination", output], { cwd: root }));
  if (!Array.isArray(packed) || packed.length !== 1) throw new Error("npm pack did not return exactly one archive");
  const entry = packed[0];
  if (entry.name !== packageInfo.name || entry.version !== packageInfo.version) throw new Error("npm packed a different package or version");
  if (typeof entry.filename !== "string" || basename(entry.filename) !== entry.filename || !entry.filename.endsWith(".tgz")) throw new Error("npm pack returned an invalid archive filename");
  const tarball = join(output, entry.filename);
  const integrity = integrityOf(await readFile(tarball));
  if (entry.integrity !== integrity) throw new Error("npm pack integrity does not match the archive bytes");
  const listing = await run("tar", ["-tzf", tarball], { cwd: root });
  validateArchivePaths(listing.trim().split(/\r?\n/u));
  const extracted = await mkdtemp(join(tmpdir(), "xiaobao-packed-check-"));
  try {
    await run("tar", ["-xzf", tarball, "-C", extracted, "--no-same-owner"], { cwd: root });
    const packageRoot = join(extracted, "package");
    const extractedInfo = validateManifest(JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")));
    if (extractedInfo.name !== packageInfo.name || extractedInfo.version !== packageInfo.version) throw new Error("Extracted package identity differs from source");
    console.log(await run(process.execPath, [join(packageRoot, "scripts", "selfcheck.mjs")], { cwd: packageRoot }));
  } finally {
    await rm(extracted, { recursive: true, force: true });
  }
  const artifact = { ...packageInfo, filename: entry.filename, tarball, integrity };
  await writeFile(join(output, "package-artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Verified ${artifact.name}@${artifact.version}: ${tarball}`);
  return artifact;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--output")) throw new Error("Usage: node scripts/release-pack.mjs [--output DIRECTORY]");
  await buildVerifiedPackage({ outputRoot: args[1] });
}
