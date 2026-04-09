# @restatedev/restate-sdk-opentelemetry

OpenTelemetry integration for the Restate TypeScript SDK.

Get started by using the `openTelemetryHook` in your Restate service/handler configuration:

```typescript
const myService = service({
    name: "MyService",
    handlers: { ... },
    options: {
        // Set up the openTelemetryHook, this will take care of the tracing span creation and context propagation
        hooks: [openTelemetryHook({ tracer: trace.getTracer("greeter-service") })],
    },
});
```

Inside your handlers you'll be able to use the `trace.getActiveSpan()` to add events, set attributes, and more:

```typescript
async function greeter(ctx: Context, name: string) {
    // Add an event using trace.getActiveSpan().addEvent()
    trace.getActiveSpan()?.addEvent("my.event", { name });

    // ctx.runs get automatically their span, child of the attempt span.
    const greeting = await ctx.run("compute-greet", async () => {
        const greeting = `Hello, ${name}!`;
        // The active span can be also used for downstream propagation
        trace.getActiveSpan()?.addEvent("greet-value", { hello: greeting });
        return greeting;
    });

    return greeting;
}
```
