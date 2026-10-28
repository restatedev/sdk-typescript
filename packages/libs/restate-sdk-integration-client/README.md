# @restatedev/restate-sdk-integration-client

Turn any source of events into Restate invocations through the Restate ingestion API.

> **Experimental.** The ingestion API is not yet part of a released Restate version.

Node-only (uses `node:http2`). Node ≥ 22.

## Installation

```bash
npm install @restatedev/restate-sdk-integration-client
```

## Create a client

Create one client for your Restate ingress URL and close it when your integration shuts down:

```ts
import { connect } from "@restatedev/restate-sdk-integration-client";

const client = connect({ url: "http://localhost:8080" });
// Use the client
await client.close();
```

Pass `authToken` to send a bearer token.

## Simple producer

Use `producer()` when your source does not provide stable offsets that you can replay.
Call `close()` (or `flush()`) to wait until Restate has durably committed everything you sent:

```ts
const producer = client.producer();
for (const record of records) {
  await producer.send({
    service: "OrderService",
    handler: "ingest",
    headers: { "content-type": "application/json" },
    body: record.payload,
  });
}
await producer.close();
```

`send()` resolves once the producer accepted the record into its buffer, not once Restate committed it.
When the buffer is full (`bufferBytes`, 32 MiB by default) `send()` waits, so **always await `send()`**:
calls that are not awaited keep waiting for buffer space without any bound.

To wait a single individual record to be committed instead, pass `waitCommitted`:

```ts
const offset = await producer.send(record, { waitCommitted: true });
```

## Exactly-once producer

Use `exactlyOnceProducer()` when your source provides stable, strictly increasing offsets.
Restate deduplicates records on `(producerId, offset)`, across streams and restarts,
so choose a producer id that remains stable across restarts and is unique to that offset sequence.

Checkpoint the committed offset in your source with `onCommitted`, or with the value returned by `flush()`.
After a restart, resume from the checkpoint: Restate drops the records it already committed.

```ts
const producer = client.exactlyOnceProducer("orders/partition-0", {
  // Optional, you can use this to add a hook to your source checkpointing
  onCommitted: (offset) => checkpoints.save("orders/partition-0", offset),
});
for (const record of sourceRecords) {
  await producer.send({
    offset: record.offset,
    service: "OrderService",
    handler: "ingest",
    body: record.payload,
  });
}
// Waits all previous records to be durably committed
const committedOffset = await producer.flush();
```

## Producer defaults

Producers accept `defaults` when every invocation shares fields such as the target service, handler, or headers.
Defaults are sent once, when the stream is opened, instead of with every invocation.
Fields set on an individual invocation override the defaults.

```ts
const producer = client.producer({
  defaults: {
    service: "OrderService",
    handler: "ingest",
    headers: { "content-type": "application/json" },
  },
});
for (const record of records) {
  await producer.send({ body: record.payload });
}
```

## Piping a source

`producer.writable` is a `WritableStream` view of the producer: writing sends the record,
closing the stream closes the producer, and the producer buffer applies backpressure to the source.

```ts
await ReadableStream.from(records)
  .pipeThrough(
    new TransformStream({
      transform: (record, controller) =>
        controller.enqueue({ body: record.payload }),
    })
  )
  .pipeTo(producer.writable);
```

With Node streams, convert it with `Writable.fromWeb`:

```ts
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

await pipeline(
  source,
  async function* (records) {
    for await (const record of records) yield { body: record.payload };
  },
  Writable.fromWeb(producer.writable, { objectMode: true })
);
```


