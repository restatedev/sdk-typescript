import * as esbuild from 'esbuild';
import { NodeModulesPolyfillPlugin } from '@esbuild-plugins/node-modules-polyfill';
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';
import * as path from 'node:path';

const nodeColonPlugin = {
	name: 'node-colon',
	setup({ onResolve, onLoad }) {
		onResolve({ filter: /^(assert|async_hooks|crypto|events|stream|stream\/promises)$/ }, args => {
			return { path: `node:${args.path}`, external: true };
		});
	}
};

const http2Plugin = {
	name: 'http2-polyfill',
	setup({ onResolve, onLoad }) {
		onResolve({ filter: /^(http2|node:http2)$/ }, args => {
			return { path: args.path, namespace: 'http2' };
		});
		onLoad({ filter: /.*/, namespace: 'http2' }, args => ({
			contents: ``,
			loader: 'js'
		}));
	}
};

const bufferAdditionalPlugin = {
	name: 'buffer-additional',
	setup({ initialOptions, onResolve, onLoad }) {
		onResolve({ filter: /_buffer_additional_polyfill_.js/ }, args => {
			return { path: args.path, namespace: 'buffer-additional' };
		});
		onLoad({ filter: /.*/, namespace: 'buffer-additional' }, args => ({
			contents: `
        Buffer.prototype.writeBigUInt64BE = function(value, offset = 0) {  
          let lo = Number(value & 0xffffffffn);
          this[offset + 7] = lo;
          lo = lo >> 8;
          this[offset + 6] = lo;
          lo = lo >> 8;
          this[offset + 5] = lo;
          lo = lo >> 8;
          this[offset + 4] = lo;
          let hi = Number(value >> 32n & 0xffffffffn);
          this[offset + 3] = hi;
          hi = hi >> 8;
          this[offset + 2] = hi;
          hi = hi >> 8;
          this[offset + 1] = hi;
          hi = hi >> 8;
          this[offset] = hi;
          return offset + 8;
        };
        
        Buffer.prototype.readBigUInt64BE = function(offset = 0) {  
          const first = this[offset];
          const last = this[offset + 7];
          if (first === undefined || last === undefined)
            throw new Error("out of bounds");

          const hi = first * 2 ** 24 +
            this[++offset] * 2 ** 16 +
            this[++offset] * 2 ** 8 +
            this[++offset];

          const lo = this[++offset] * 2 ** 24 +
            this[++offset] * 2 ** 16 +
            this[++offset] * 2 ** 8 +
            last;

          return (BigInt(hi) << 32n) + BigInt(lo);
        };
`,
			loader: 'js'
		}));

		initialOptions.inject.push(path.resolve('_buffer_additional_polyfill_.js'));
	}
};

await esbuild.build({
	entryPoints: ['src/public_api.ts'],
	bundle: true,
	format: 'esm',
	outfile: 'dist/cloudflare_bundle.js',
	plugins: [nodeColonPlugin, http2Plugin, NodeModulesPolyfillPlugin(), NodeGlobalsPolyfillPlugin({ buffer: true }), bufferAdditionalPlugin]
});
