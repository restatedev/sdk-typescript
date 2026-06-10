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

// Forwarded-path handling. Pure — no I/O.

/**
 * Strip the tunnel's forwarded prefix `/<scheme>/<host>/<port>` and return
 * the tail — the path the SDK should see.
 *
 * A forwarded invocation arrives down the tunnel with its destination
 * encoded in the path (`/http/my-service.ns.svc.cluster.local/9080/invoke/...`);
 * the cloud proxy has already stripped the `/<env>/<tunnel>` rendezvous
 * prefix. For an in-process SDK deployment the scheme/host/port are
 * vestigial (the receiver *is* the service), so we drop exactly those three
 * segments and keep the tail (`/discover`, `/invoke/<svc>/<handler>`, …).
 *
 * The tail is passed through without re-encoding: the SDK verifies each
 * request's identity JWT against the signed service-relative path (its
 * routing and verification tolerate extra path *prefixes*, but re-encoding,
 * normalization or case folding of the tail itself would break the match).
 * The query string is preserved (it is not part of `aud`).
 *
 * Returns `null` if the path isn't a forwarded `/<scheme>/<host>/<port>/...`
 * path.
 */
export function forwardedTail(rawUrl: string): string | null {
  const qIdx = rawUrl.indexOf("?");
  const path = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
  const query = qIdx === -1 ? "" : rawUrl.slice(qIdx);
  const seg = path.split("/"); // ["", scheme, host, port, ...tail]
  // The port segment must be numeric — that's what distinguishes a real
  // forwarded prefix from an unprefixed SDK path that happens to have three
  // segments (e.g. `/invoke/Svc/handler` must NOT parse as scheme=invoke,
  // host=Svc, port=handler and dispatch `/` to the SDK).
  if (
    seg.length < 4 ||
    seg[1] === "" ||
    seg[2] === "" ||
    !/^\d+$/.test(seg[3]!)
  ) {
    return null;
  }
  const tail = "/" + seg.slice(4).join("/");
  return query ? tail + query : tail;
}
