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
 * Journal entry codec type.
 */
export type JournalEntryCodec = {
  /**
   * Encodes the given buffer.
   *
   * This will be applied *after* serialization.
   *
   * @param buf The buffer to encode.
   * @returns A promise that resolves to the encoded buffer.
   */
  encode(buf: Uint8Array): Promise<Uint8Array>;

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
