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

/**
 * Journal values codec.
 *
 * This allows to transform journal values after being serialized, before writing them to the wire.
 *
 * Values that are passed through the codec:
 *
 * * Handlers input and success output
 * * ctx.run success results
 * * Awakeables/Promise success results
 * * State values
 *
 * @experimental
 */
export type JournalValueCodec = {
  /**
   * Encodes the given buffer.
   *
   * This will be applied *after* serialization.
   *
   * @param buf The buffer to encode. Empty byte buffers should be appropriately handled as well.
   * @returns The encoded buffer
   */
  encode(buf: Uint8Array): Uint8Array;

  /**
   * Decodes the given buffer.
   *
   * This will be applied *before* deserialization.
   *
   * @param buf The buffer to decode.
   * @returns A promise that resolves to the decoded buffer.
   */
  decode(buf: Uint8Array): Promise<Uint8Array>;
};
