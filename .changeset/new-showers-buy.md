---
"@restatedev/restate-sdk": patch
"@restatedev/restate-sdk-clients": patch
"@restatedev/restate-sdk-cloudflare-workers": patch
"@restatedev/restate-sdk-core": patch
"@restatedev/restate-sdk-testcontainers": patch
"@restatedev/restate-sdk-zod": patch
---

Add rpc.opts({name})/rpc.sendOpts({name}) to propagate entry name for call. This allows tagging from caller perspective a request.
