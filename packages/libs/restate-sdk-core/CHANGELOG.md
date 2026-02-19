# @restatedev/restate-sdk-core

## 1.10.3

### Patch Changes

- 4b477f6: Add rpc.opts({name})/rpc.sendOpts({name}) to propagate entry name for call. This allows tagging from caller perspective a request.
- ef1cc48: Added new journal incompatibility assertion to shared-core, to detect if an await was added mutating code in-place.
- 4b477f6: Update the shared core to 0.8.0

## 1.10.2

### Patch Changes

- Fix error stacktrace propagation on ctx.run failures
- Fix restate.serde.schema config propagation

## 1.10.1

### Patch Changes

- 7b49297: Fix standard schema import

## 1.10.0

### Minor Changes

- df0ffc3: Introduce `restate.serde.schema` to create a serde using the Standard Schema spec
