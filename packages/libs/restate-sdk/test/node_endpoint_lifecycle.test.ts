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

import * as http from "node:http";
import * as http2 from "node:http2";
import * as net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RestateRequest,
  RestateResponse,
} from "../src/endpoint/handlers/types.js";

type ProcessArgs = Parameters<RestateResponse["process"]>[0];

const restateHandlerMock = vi.hoisted(() => ({
  process:
    vi.fn<(request: RestateRequest, args: ProcessArgs) => Promise<void>>(),
}));

vi.mock("../src/endpoint/handlers/generic.js", () => ({
  createRestateHandler: () => ({
    handle: (request: RestateRequest) => ({
      process: (args: ProcessArgs) => restateHandlerMock.process(request, args),
    }),
  }),
}));

import { NodeEndpoint } from "../src/endpoint/node_endpoint.js";

const LOOPBACK = "127.0.0.1";
const EVENT_TIMEOUT = 3_000;
const RESPONSE_BODY = new TextEncoder().encode("response");

async function withTimeout<T>(promise: Promise<T>, description: string) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${description}`)),
      EVENT_TIMEOUT
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

async function readRequest(inputReader: AsyncIterator<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  while (true) {
    const next = await inputReader.next();
    if (next.done) {
      return Buffer.concat(chunks);
    }
    chunks.push(next.value);
  }
}

function nextEventLoopTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

type TestServer = http.Server | http2.Http2Server;
type Cleanup = () => void | Promise<void>;

let cleanups: Cleanup[] = [];

function cleanupWith(cleanup: Cleanup) {
  cleanups.push(cleanup);
}

beforeEach(() => {
  cleanups = [];
  restateHandlerMock.process.mockReset();
});

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup();
    } catch {
      // Cleanup is best effort so it does not hide the lifecycle assertion.
    }
  }
});

async function listen(server: TestServer): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK, () => {
      server.off("error", reject);
      resolve();
    });
  });

  cleanupWith(async () => {
    if (!server.listening) {
      return;
    }

    if ("closeAllConnections" in server) {
      server.closeAllConnections();
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  return (server.address() as AddressInfo).port;
}

async function startHttp1Server() {
  const server = http.createServer(new NodeEndpoint().http1Handler());
  return await listen(server);
}

async function startHttp2Server() {
  const server = http2.createServer(new NodeEndpoint().http2Handler());
  return await listen(server);
}

function openHttp1Request(
  port: number,
  path = "/invoke",
  options: { agent?: http.Agent; contentLength?: number } = {}
) {
  const request = http.request({
    host: LOOPBACK,
    port,
    path,
    method: "POST",
    agent: options.agent,
    headers:
      options.contentLength === undefined
        ? undefined
        : { "content-length": options.contentLength },
  });
  request.on("error", () => {
    // Connection failures are deliberately triggered by these tests.
  });
  cleanupWith(() => request.destroy());
  return request;
}

function readHttp1Response(request: http.ClientRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    request.once("response", (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => resolve(Buffer.concat(chunks)));
      response.once("error", reject);
    });
    request.once("error", reject);
  });
}

async function connectHttp2(port: number) {
  const session = http2.connect(`http://${LOOPBACK}:${port}`);
  session.on("error", () => {
    // Connection failures are deliberately triggered by these tests.
  });
  cleanupWith(() => session.destroy());
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      session.once("connect", resolve);
      session.once("error", reject);
    }),
    "the HTTP/2 session to connect"
  );
  return session;
}

async function connectHttp2WithSocket(port: number) {
  let socket: net.Socket | undefined;
  const session = http2.connect(`http://${LOOPBACK}:${port}`, {
    createConnection: () => {
      socket = net.connect({ host: LOOPBACK, port });
      socket.on("error", () => {
        // The test deliberately destroys this socket.
      });
      return socket;
    },
  });
  session.on("error", () => {
    // Connection failures are deliberately triggered by these tests.
  });
  cleanupWith(() => session.destroy());
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      session.once("connect", resolve);
      session.once("error", reject);
    }),
    "the HTTP/2 session to connect"
  );

  if (socket === undefined) {
    throw new Error("HTTP/2 did not create a TCP socket");
  }
  cleanupWith(() => socket?.destroy());
  return { session, socket };
}

function openHttp2Request(
  session: http2.ClientHttp2Session,
  path = "/invoke",
  contentLength?: number
) {
  const request = session.request({
    ":method": "POST",
    ":path": path,
    ...(contentLength === undefined ? {} : { "content-length": contentLength }),
  });
  request.on("error", () => {
    // Stream resets are deliberately triggered by these tests.
  });
  cleanupWith(() => request.destroy());
  return request;
}

function readHttp2Response(request: http2.ClientHttp2Stream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.once("end", () => resolve(Buffer.concat(chunks)));
    request.once("error", reject);
  });
}

describe("NodeEndpoint HTTP/1 attempt lifecycle", () => {
  it("aborts when the connection drops before the request body is read", async () => {
    const processStarted = Promise.withResolvers<ProcessArgs>();
    restateHandlerMock.process.mockImplementation(async (_request, args) => {
      processStarted.resolve(args);
      try {
        await readRequest(args.inputReader);
      } catch {
        // The incomplete request can reject the input iterator.
      }
    });

    const port = await startHttp1Server();
    const request = openHttp1Request(port, "/invoke", { contentLength: 4 });
    request.flushHeaders();

    const args = await withTimeout(
      processStarted.promise,
      "HTTP/1 processing to start"
    );
    expect(args.abortSignal.aborted).toBe(false);

    const aborted = waitForAbort(args.abortSignal);
    request.destroy();

    await withTimeout(aborted, "the HTTP/1 attempt to abort");
    expect(args.abortSignal.aborted).toBe(true);
  });

  it("aborts at the connection drop while the handler is running", async () => {
    const requestRead = Promise.withResolvers<ProcessArgs>();
    restateHandlerMock.process.mockImplementation(async (_request, args) => {
      await readRequest(args.inputReader);
      requestRead.resolve(args);
      await waitForAbort(args.abortSignal);
    });

    const port = await startHttp1Server();
    const request = openHttp1Request(port);
    request.end("request");

    const args = await withTimeout(
      requestRead.promise,
      "the HTTP/1 request body to be read"
    );
    await nextEventLoopTurn();
    expect.soft(args.abortSignal.aborted).toBe(false);

    request.destroy();

    await withTimeout(
      waitForAbort(args.abortSignal),
      "the HTTP/1 attempt to abort during handler execution"
    );
    expect(args.abortSignal.aborted).toBe(true);
  });

  it("aborts at the connection drop while the response is being written", async () => {
    const responseWriting = Promise.withResolvers<ProcessArgs>();
    restateHandlerMock.process.mockImplementation(async (_request, args) => {
      await readRequest(args.inputReader);
      args.writeHead(200, { "content-type": "application/octet-stream" });
      await args.outputWriter.write(RESPONSE_BODY);
      responseWriting.resolve(args);
      await waitForAbort(args.abortSignal);
    });

    const port = await startHttp1Server();
    const request = openHttp1Request(port);
    const responseStarted = new Promise<http.IncomingMessage>(
      (resolve, reject) => {
        request.once("response", resolve);
        request.once("error", reject);
      }
    );
    request.end("request");

    const [args, response] = await Promise.all([
      withTimeout(responseWriting.promise, "the HTTP/1 response to start"),
      withTimeout(responseStarted, "the HTTP/1 client response"),
    ]);
    response.on("error", () => {
      // The test deliberately destroys the response.
    });
    await nextEventLoopTurn();
    expect.soft(args.abortSignal.aborted).toBe(false);

    response.destroy();

    await withTimeout(
      waitForAbort(args.abortSignal),
      "the HTTP/1 attempt to abort during its response"
    );
    expect(args.abortSignal.aborted).toBe(true);
  });

  it("aborts after a complete response", async () => {
    const requestRead = Promise.withResolvers<ProcessArgs>();
    const finishHandler = Promise.withResolvers<void>();
    cleanupWith(() => finishHandler.resolve(undefined));
    restateHandlerMock.process.mockImplementation(async (_request, args) => {
      await readRequest(args.inputReader);
      requestRead.resolve(args);
      await finishHandler.promise;
      args.writeHead(200, { "content-type": "application/octet-stream" });
      await args.outputWriter.write(RESPONSE_BODY);
      await args.outputWriter.close();
    });

    const port = await startHttp1Server();
    const request = openHttp1Request(port);
    const response = readHttp1Response(request);
    request.end("request");

    const args = await withTimeout(
      requestRead.promise,
      "the HTTP/1 request body to be read"
    );
    await nextEventLoopTurn();
    expect.soft(args.abortSignal.aborted).toBe(false);

    finishHandler.resolve(undefined);
    expect(await withTimeout(response, "the complete HTTP/1 response")).toEqual(
      Buffer.from(RESPONSE_BODY)
    );
    await withTimeout(
      waitForAbort(args.abortSignal),
      "the completed HTTP/1 attempt to abort"
    );
    expect(args.abortSignal.aborted).toBe(true);
  });

  it("tracks each attempt separately on a keep-alive connection", async () => {
    const firstRequestRead = Promise.withResolvers<ProcessArgs>();
    const secondRequestRead = Promise.withResolvers<ProcessArgs>();
    const finishFirst = Promise.withResolvers<void>();
    const finishSecond = Promise.withResolvers<void>();
    cleanupWith(() => finishFirst.resolve(undefined));
    cleanupWith(() => finishSecond.resolve(undefined));

    const abortCounts = new Map<string, number>();
    restateHandlerMock.process.mockImplementation(async (request, args) => {
      args.abortSignal.addEventListener(
        "abort",
        () => {
          abortCounts.set(request.url, (abortCounts.get(request.url) ?? 0) + 1);
        },
        { once: true }
      );
      await readRequest(args.inputReader);

      const finish = request.url === "/first" ? finishFirst : finishSecond;
      const requestRead =
        request.url === "/first" ? firstRequestRead : secondRequestRead;
      requestRead.resolve(args);
      await finish.promise;
      args.writeHead(200, { "content-type": "application/octet-stream" });
      await args.outputWriter.close();
    });

    const port = await startHttp1Server();
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    cleanupWith(() => agent.destroy());

    const first = openHttp1Request(port, "/first", { agent });
    const firstSocket = Promise.withResolvers<net.Socket>();
    first.once("socket", (socket) => firstSocket.resolve(socket));
    const firstResponse = readHttp1Response(first);
    first.end("first");

    const firstArgs = await withTimeout(
      firstRequestRead.promise,
      "the first keep-alive request to be read"
    );
    await nextEventLoopTurn();
    expect.soft(firstArgs.abortSignal.aborted).toBe(false);
    finishFirst.resolve(undefined);
    await withTimeout(firstResponse, "the first keep-alive response");
    await withTimeout(
      waitForAbort(firstArgs.abortSignal),
      "the first keep-alive attempt to abort"
    );

    const second = openHttp1Request(port, "/second", { agent });
    const secondSocket = Promise.withResolvers<net.Socket>();
    second.once("socket", (socket) => secondSocket.resolve(socket));
    const secondResponse = readHttp1Response(second);
    second.end("second");

    const secondArgs = await withTimeout(
      secondRequestRead.promise,
      "the second keep-alive request to be read"
    );
    await nextEventLoopTurn();
    expect.soft(secondArgs.abortSignal.aborted).toBe(false);
    expect(await firstSocket.promise).toBe(await secondSocket.promise);
    expect(firstArgs.abortSignal).not.toBe(secondArgs.abortSignal);

    finishSecond.resolve(undefined);
    await withTimeout(secondResponse, "the second keep-alive response");
    await withTimeout(
      waitForAbort(secondArgs.abortSignal),
      "the second keep-alive attempt to abort"
    );

    expect(abortCounts).toEqual(
      new Map([
        ["/first", 1],
        ["/second", 1],
      ])
    );
  });
});

describe("NodeEndpoint HTTP/2 attempt lifecycle", () => {
  it("aborts when the stream resets before the request body is read", async () => {
    const processStarted = Promise.withResolvers<ProcessArgs>();
    restateHandlerMock.process.mockImplementation(async (_request, args) => {
      processStarted.resolve(args);
      try {
        await readRequest(args.inputReader);
      } catch {
        // The reset request can reject the input iterator.
      }
    });

    const port = await startHttp2Server();
    const session = await connectHttp2(port);
    const request = openHttp2Request(session, "/invoke", 4);

    const args = await withTimeout(
      processStarted.promise,
      "HTTP/2 processing to start"
    );
    expect(args.abortSignal.aborted).toBe(false);

    request.close(http2.constants.NGHTTP2_CANCEL);

    await withTimeout(
      waitForAbort(args.abortSignal),
      "the reset HTTP/2 attempt to abort"
    );
    expect(args.abortSignal.aborted).toBe(true);
  });

  it("aborts at a stream reset while the handler is running", async () => {
    const requestRead = Promise.withResolvers<ProcessArgs>();
    restateHandlerMock.process.mockImplementation(async (_request, args) => {
      await readRequest(args.inputReader);
      requestRead.resolve(args);
      await waitForAbort(args.abortSignal);
    });

    const port = await startHttp2Server();
    const session = await connectHttp2(port);
    const request = openHttp2Request(session);
    request.end("request");

    const args = await withTimeout(
      requestRead.promise,
      "the HTTP/2 request body to be read"
    );
    await nextEventLoopTurn();
    expect(args.abortSignal.aborted).toBe(false);

    request.close(http2.constants.NGHTTP2_CANCEL);

    await withTimeout(
      waitForAbort(args.abortSignal),
      "the HTTP/2 attempt to abort during handler execution"
    );
    expect(args.abortSignal.aborted).toBe(true);
  });

  it("aborts at a stream reset while the response is being written", async () => {
    const responseWriting = Promise.withResolvers<ProcessArgs>();
    restateHandlerMock.process.mockImplementation(async (_request, args) => {
      await readRequest(args.inputReader);
      args.writeHead(200, { "content-type": "application/octet-stream" });
      await args.outputWriter.write(RESPONSE_BODY);
      responseWriting.resolve(args);
      await waitForAbort(args.abortSignal);
    });

    const port = await startHttp2Server();
    const session = await connectHttp2(port);
    const request = openHttp2Request(session);
    const responseStarted = new Promise<void>((resolve) => {
      request.once("response", () => resolve());
    });
    request.end("request");

    const args = await withTimeout(
      responseWriting.promise,
      "the HTTP/2 response to start"
    );
    await withTimeout(responseStarted, "the HTTP/2 client response");
    await nextEventLoopTurn();
    expect(args.abortSignal.aborted).toBe(false);

    request.close(http2.constants.NGHTTP2_CANCEL);

    await withTimeout(
      waitForAbort(args.abortSignal),
      "the HTTP/2 attempt to abort during its response"
    );
    expect(args.abortSignal.aborted).toBe(true);
  });

  it("aborts after a complete response", async () => {
    const requestRead = Promise.withResolvers<ProcessArgs>();
    const finishHandler = Promise.withResolvers<void>();
    cleanupWith(() => finishHandler.resolve(undefined));
    restateHandlerMock.process.mockImplementation(async (_request, args) => {
      await readRequest(args.inputReader);
      requestRead.resolve(args);
      await finishHandler.promise;
      args.writeHead(200, { "content-type": "application/octet-stream" });
      await args.outputWriter.write(RESPONSE_BODY);
      await args.outputWriter.close();
    });

    const port = await startHttp2Server();
    const session = await connectHttp2(port);
    const request = openHttp2Request(session);
    const response = readHttp2Response(request);
    request.end("request");

    const args = await withTimeout(
      requestRead.promise,
      "the HTTP/2 request body to be read"
    );
    await nextEventLoopTurn();
    expect(args.abortSignal.aborted).toBe(false);

    finishHandler.resolve(undefined);
    expect(await withTimeout(response, "the complete HTTP/2 response")).toEqual(
      Buffer.from(RESPONSE_BODY)
    );
    await withTimeout(
      waitForAbort(args.abortSignal),
      "the completed HTTP/2 attempt to abort"
    );
    expect(args.abortSignal.aborted).toBe(true);
  });

  it("aborts an active attempt when the HTTP/2 connection drops", async () => {
    const requestRead = Promise.withResolvers<ProcessArgs>();
    restateHandlerMock.process.mockImplementation(async (_request, args) => {
      await readRequest(args.inputReader);
      requestRead.resolve(args);
      await waitForAbort(args.abortSignal);
    });

    const port = await startHttp2Server();
    const { session, socket } = await connectHttp2WithSocket(port);
    const request = openHttp2Request(session);
    request.end("request");

    const args = await withTimeout(
      requestRead.promise,
      "the HTTP/2 request body to be read"
    );
    await nextEventLoopTurn();
    expect(args.abortSignal.aborted).toBe(false);

    socket.destroy();

    await withTimeout(
      waitForAbort(args.abortSignal),
      "the HTTP/2 attempt to abort after connection loss"
    );
    expect(args.abortSignal.aborted).toBe(true);
  });

  it("aborts only the reset stream when requests share a connection", async () => {
    const firstRequestRead = Promise.withResolvers<ProcessArgs>();
    const secondRequestRead = Promise.withResolvers<ProcessArgs>();
    const finishSecond = Promise.withResolvers<void>();
    cleanupWith(() => finishSecond.resolve(undefined));

    restateHandlerMock.process.mockImplementation(async (request, args) => {
      await readRequest(args.inputReader);
      if (request.url === "/first") {
        firstRequestRead.resolve(args);
        await waitForAbort(args.abortSignal);
        return;
      }

      secondRequestRead.resolve(args);
      await finishSecond.promise;
      args.writeHead(200, { "content-type": "application/octet-stream" });
      await args.outputWriter.close();
    });

    const port = await startHttp2Server();
    const session = await connectHttp2(port);
    const first = openHttp2Request(session, "/first");
    const second = openHttp2Request(session, "/second");
    const secondResponse = readHttp2Response(second);
    first.end("first");
    second.end("second");

    const [firstArgs, secondArgs] = await Promise.all([
      withTimeout(firstRequestRead.promise, "the first HTTP/2 request"),
      withTimeout(secondRequestRead.promise, "the second HTTP/2 request"),
    ]);
    expect(firstArgs.abortSignal.aborted).toBe(false);
    expect(secondArgs.abortSignal.aborted).toBe(false);

    first.close(http2.constants.NGHTTP2_CANCEL);

    await withTimeout(
      waitForAbort(firstArgs.abortSignal),
      "the reset HTTP/2 stream to abort"
    );
    expect(firstArgs.abortSignal.aborted).toBe(true);
    expect(secondArgs.abortSignal.aborted).toBe(false);

    finishSecond.resolve(undefined);
    await withTimeout(secondResponse, "the second HTTP/2 response");
    await withTimeout(
      waitForAbort(secondArgs.abortSignal),
      "the completed second HTTP/2 stream to abort"
    );
    expect(secondArgs.abortSignal.aborted).toBe(true);
  });
});
