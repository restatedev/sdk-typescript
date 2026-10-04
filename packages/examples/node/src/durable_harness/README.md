# A durable agent harness on the storage journal mode

A thin slice of [pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable)'s model, built on
the experimental storage journal mode and transactions, as a design validation. See
`docs/transactional-handlers.md` in sdk-shared-core for those.

## Model

pi-durable's core rule: a session atomically commits transcript entries, task records and documents, and only
committed state is observable. Tasks are durable state machines: a phase performs external effects outside of the
mutation line, then commits its next checkpoint ("commit intent, perform effect, commit outcome"). Nothing is replayed.

| pi-durable | Here |
|---|---|
| Session, its single mutation line | `session` virtual object: every exclusive handler is one transaction (`ctx.transaction`), on lazy state (`kv.load`) |
| `commit(tx => ...)` | a named commit function of the task kind, applied by `session.commit` |
| `createTask` in a commit | task record written + `taskRunner.run()` sent by the same transaction |
| Task phases, effects off the line | `taskRunner` (key `session:task`), storage journal mode |
| Commit gate (task still running, at the expected checkpoint) | `seq` in the task record, checked by `session.commit` |
| `waiting` on child tasks | the commit making the last child terminal resumes the owner and sends its `run()` |
| Recovery from the checkpoint | the runner loads the checkpoint with a `fresh` call on every attempt |
| Throttled partial output | `progress` one-way sends, dropped if the task moved on |
| Tool `replay: "safe"` / interrupted result | tool task phases `call` (intent, effect, result) and `execute` (recovery only) |
| Submission `requestId` | Restate idempotency key on `session.submit` |

One input with a tool round:

```text
submit           -> pi.user entry, generation G (request)               [session transaction]
G request        -> stream the model, progress sends                     [runner, off the line]
G response       -> assistant entry, tool tasks T1..Tn, G waits on them  [session transaction]
Ti call          -> intent commit, execute the tool, result commit       [runner + 2 transactions]
last Ti result   -> G resumes in its tools phase                         [same transaction]
G toolsDone      -> next generation, which answers                       [session transaction]
```

## Files

- `types.ts`: entries, task records, submissions, documents.
- `tasks.ts`: the generation and tool tasks, as phases (effects) and commits (reducers).
- `session.ts`: the Session object.
- `runner.ts`: the TaskRunner object.
- `model.ts`: a faux streaming model. `tools.ts`: a replay-safe tool, an unsafe one, a slow one.
- `crash.ts`: crash injection. `scenarios.ts`: the recovery scenarios.

## Running

```bash
# restate-server running, then from packages/examples/node:
while true; do HARNESS_TEST_DIR=/tmp/durable-harness PORT=9080 npx tsx --tsconfig ./tsconfig.json ./src/durable_harness/app.ts; done
restate deployments register http://localhost:9080
HARNESS_TEST_DIR=/tmp/durable-harness npx tsx --tsconfig ./tsconfig.json ./src/durable_harness/scenarios.ts
```

The endpoint must be restarted when it exits: the crash scenarios kill it on purpose.

## Scenarios

`scenarios.ts` checks, against restate-server 1.7.13:

| Scenario | Checks |
|---|---|
| chat | one input, one answer |
| tools | a parallel tool round of two calls, then the answer |
| crash in a replay-safe tool | the process dies inside the tool: the tool runs again, the run completes |
| crash in an unsafe tool | the process dies after the tool's effect: the tool doesn't run again, the model gets an `interrupted` result |
| crash while streaming | the process dies mid-stream: the committed partial becomes an aborted entry, the next attempt answers |
| follow-up while busy | a second input queued during a run is answered after it |
| idempotent submit | the same idempotency key returns the same submission |

## Findings

- The checkpoint is the recovery signal, as in pi-durable: the runner loads it with a `fresh` call on every attempt,
  and finds a tool task in its `execute` phase after a crash between intent and result. No "was this recovered" flag needed.
- Commits named after the checkpoint sequence number are applied exactly once, even when the attempt dies while
  the commit call is in flight; the Session's `seq` gate rejects anything stale.
- Commit callbacks had to become named functions of the task kind, because they run in the Session, not in the runner.
- One-way sends were held in the SDK's output buffer until the next await, so progress reports sent while
  streaming were lost on a crash. The SDK now flushes right after a send in the storage journal mode.
- Lazy reads are not snapshot-consistent: a shared handler reading several keys can observe a state that never
  existed, when a commit lands between two reads. `view` uses the eager snapshot instead.
- Cost of one input with a tool round of two calls: 9 commits, each a Session invocation; the 29 lazy reads inside
  them are journaled (58 entries) although nothing ever replays them; 10 fresh checkpoint loads, each a full call.
