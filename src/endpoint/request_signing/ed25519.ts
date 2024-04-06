import { Buffer } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import * as crypto from 'node:crypto';

const USE_WEB_CRYPTO =
	globalThis.process?.env?.USE_WEB_CRYPTO == 'true' ||
	globalThis.process?.release?.name !== 'node';

export type Key =
	| { type: 'web'; key: webcrypto.CryptoKey }
	| { type: 'node'; key: crypto.KeyObject };

export async function importKey(derBytes: Buffer): Promise<Key> {
	if (!USE_WEB_CRYPTO) {
		return {
			type: 'node',
			key: crypto.createPublicKey({
				key: derBytes,
				format: 'der',
				type: 'spki'
			})
		};
	} else {
		return {
			type: 'web',
			key: await webcrypto.subtle.importKey(
				'spki',
				derBytes,
				{ name: 'Ed25519' },
				false,
				['verify']
			)
		};
	}
}

export async function verify(
	key: Key,
	signatureBuf: Buffer,
	data: Buffer
): Promise<boolean> {
	if (key.type == 'node') {
		return crypto.verify(null, data, key.key, signatureBuf);
	} else {
		return await webcrypto.subtle.verify(
			{ name: 'Ed25519' },
			key.key,
			signatureBuf,
			data
		);
	}
}
