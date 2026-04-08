/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { CommandError } from "./context_impl.js";
import { ensureError } from "./types/errors.js";

/**
 * Strips SDK-internal metadata from an error before it enters the interceptor
 * chain. Interceptors see a plain Error — no CommandError.
 */
export function sanitizeError(e: unknown): Error {
  if (e instanceof CommandError) return ensureError(e.cause);
  return ensureError(e);
}

/**
 * Restores SDK-internal metadata after the interceptor chain exits, using the
 * original error's metadata and the interceptor's error as the new cause.
 * If the original had no SDK metadata, the interceptor's error passes through
 * unchanged.
 */
export function restoreError(
  interceptorError: unknown,
  original: unknown
): unknown {
  if (original instanceof CommandError) {
    return original.commandIndex !== undefined
      ? new CommandError(
          interceptorError,
          original.commandType,
          original.commandIndex
        )
      : new CommandError(interceptorError, original.commandType);
  }
  return interceptorError;
}
