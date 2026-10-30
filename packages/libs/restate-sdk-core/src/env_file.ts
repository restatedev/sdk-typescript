/*
 * Copyright (c) 2023-2026 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/** Outcome of {@link loadEnvFile}. */
export type LoadEnvFileResult =
  /** The file was read and its variables added to `process.env`. */
  | "loaded"
  /** No file at that path; nothing changed. */
  | "missing"
  /** This runtime has no `process.loadEnvFile` (e.g. a browser or worker); nothing changed. */
  | "unsupported";

/**
 * Load a dotenv-style file into `process.env` **without overriding** variables
 * that are already set, so it composes with `node --env-file`, Bun's automatic
 * `.env` loading, Docker and CI environments. Uses Node's built-in
 * `process.loadEnvFile()` (Node ≥ 20.12), no dependency.
 *
 * `restate.serve()` and `clients.connect()` call this on `./.env` to pick up
 * the Restate Cloud credential bundle written by `restate cloud link`.
 *
 * @param path path of the file, relative to the working directory. Default `.env`.
 * @returns whether the file was loaded, see {@link LoadEnvFileResult}. Throws on
 * I/O errors other than a missing file.
 */
export function loadEnvFile(path = ".env"): LoadEnvFileResult {
  const proc = (
    globalThis as { process?: { loadEnvFile?: (path: string) => void } }
  ).process;
  if (proc === undefined || typeof proc.loadEnvFile !== "function") {
    return "unsupported";
  }
  try {
    proc.loadEnvFile(path);
    return "loaded";
  } catch (e) {
    if ((e as { code?: unknown } | undefined)?.code === "ENOENT") {
      return "missing";
    }
    throw e;
  }
}

/**
 * Read an environment variable, treating an empty value as unset.
 * Safe on runtimes without `process` (returns `undefined`).
 */
export function readEnvVar(name: string): string | undefined {
  const value = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env?.[name];
  return value === undefined || value === "" ? undefined : value;
}
