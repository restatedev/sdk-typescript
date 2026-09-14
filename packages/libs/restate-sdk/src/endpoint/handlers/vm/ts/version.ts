/*
 * Copyright (c) 2023-2025 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/** Service protocol version, mirrors `service_protocol::Version` in the shared core. */
export enum Version {
  V1 = 1,
  V2 = 2,
  V3 = 3,
  V4 = 4,
  V5 = 5,
  V6 = 6,
  V7 = 7,
}

const CONTENT_TYPE_PREFIX = "application/vnd.restate.invocation.";

const CONTENT_TYPES: Record<Version, string> = {
  [Version.V1]: `${CONTENT_TYPE_PREFIX}v1`,
  [Version.V2]: `${CONTENT_TYPE_PREFIX}v2`,
  [Version.V3]: `${CONTENT_TYPE_PREFIX}v3`,
  [Version.V4]: `${CONTENT_TYPE_PREFIX}v4`,
  [Version.V5]: `${CONTENT_TYPE_PREFIX}v5`,
  [Version.V6]: `${CONTENT_TYPE_PREFIX}v6`,
  [Version.V7]: `${CONTENT_TYPE_PREFIX}v7`,
};

export const MINIMUM_SUPPORTED_VERSION = Version.V5;
export const MAXIMUM_SUPPORTED_VERSION = Version.V7;

export function versionContentType(v: Version): string {
  return CONTENT_TYPES[v];
}

/** Display form of a version, same as the Rust `Display` impl (the content type). */
export function versionToString(v: Version): string {
  return versionContentType(v);
}

export class ContentTypeError extends Error {
  constructor(
    readonly kind: "RestateContentType" | "OtherContentType",
    message: string
  ) {
    super(message);
    this.name = "ContentTypeError";
  }
}

export function parseVersion(s: string): Version {
  for (const [v, ct] of Object.entries(CONTENT_TYPES)) {
    if (ct === s) {
      return Number(v) as Version;
    }
  }
  if (s.startsWith(CONTENT_TYPE_PREFIX)) {
    throw new ContentTypeError(
      "RestateContentType",
      `unsupported protocol version '${s}'`
    );
  }
  throw new ContentTypeError(
    "OtherContentType",
    `unrecognized content-type '${s}', this is not a restate protocol content type. Make sure you're invoking the service though restate-server, rather than directly.`
  );
}
