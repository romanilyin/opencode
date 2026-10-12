import { expect, test } from "bun:test"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { Tool } from "@opencode/core/tool"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { McpTool } from "@opencode/core/tool/mcp"
import { ToolProgress } from "@opencode/core/tool/progress"
import { ToolPresentation } from "@opencode/util/tool-presentation"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Deferred, Effect, Schema, Layer, Stream, Fiber } from "effect"
import { Mcp } from "@opencode/core/mcp/index"
import { Permission } from "@opencode/core/permission"
import { Bus } from "@opencode/core/bus"

const layer = AppNodeBuilder.build(LayerNode.group([Tool.node, PluginHooks.node]), [
  Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
])
const identity = {
  sessionID: Session.ID.make("ses_presentation"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_presentation"),
}
const execute = (snapshot: Tool.Snapshot, name: string, input: unknown, progress?: Tool.Context["progress"]) =>
  snapshot.execute({
    ...identity,
    call: { type: "tool-call", id: "call_presentation", name, input },
    ...(progress ? { progress } : {}),
  })

test("host metadata preserves unsupported presentation slots without reinterpreting them", () => {
  const previous = { unrelated: "retained", toolPresentation: { schemaVersion: 1, label: "old" } }
  for (const toolPresentation of [{ schemaVersion: 2, label: "future" }, "foreign", null]) {
    const result = ToolProgress.merge(previous, { toolPresentation })
    expect(result).toEqual({ unrelated: "retained", toolPresentation })
    expect(ToolPresentation.read(result)).toBeUndefined()
  }
})

for (const phase of ["progress", "terminal"]) {
  for (const kind of ["accessor", "presentation accessor", "proxy"]) {
    test(`hostile ${kind} ${phase} metadata cannot fail or replay a successful executor`, () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const tools = yield* Tool.Service
          let executions = 0
          let getterReads = 0
          const own = { unrelated: "retained", toolPresentation: { schemaVersion: 1, label: "Safe action" } }
          const hostile =
            kind !== "proxy"
              ? Object.defineProperty(own, kind === "presentation accessor" ? "toolPresentation" : "hostile", {
                  enumerable: true,
                  get() {
                    getterReads += 1
                    throw new Error("metadata getter must not run")
                  },
                })
              : new Proxy(own, {
                  ownKeys() {
                    throw new Error("metadata introspection failed")
                  },
                })
          yield* tools.transform((editor) =>
            editor.add({
              name: "once",
              description: "Execute once",
              input: {},
              output: Schema.String,
              options: { codemode: false },
              execute: (_, context) =>
                Effect.gen(function* () {
                  executions += 1
                  yield* context.progress({
                    before: "retained",
                    toolPresentation: { schemaVersion: 1, label: "Initial action" },
                  })
                  if (phase === "progress") yield* context.progress(hostile)
                  return { output: "canonical", metadata: phase === "terminal" ? hostile : { terminal: "retained" } }
                }),
            }),
          )
          const updates: Tool.Metadata[] = []
          const snapshot = yield* tools.snapshot()
          const result = yield* execute(snapshot, "once", {}, (update) =>
            Effect.sync(() => {
              updates.push(update)
            }),
          )
          expect(result.output).toBe("canonical")
          expect(result.content).toEqual([{ type: "text", text: "canonical" }])
          expect(result.metadata?.before).toBe("retained")
          if (kind !== "proxy") expect(result.metadata?.unrelated).toBe("retained")
          expect(result.metadata).not.toHaveProperty("hostile")
          expect(() => JSON.stringify(updates)).not.toThrow()
          expect(getterReads).toBe(0)
          expect(executions).toBe(1)
        }).pipe(Effect.scoped, Effect.provide(layer)),
      ))
  }
}

test("MCP descriptor titles and inline server icon fallback are independent of tool identity", () => {
  const icon = { src: "data:image/png;base64,iVBORw0KGgo=" }
  expect(
    McpTool.presentation({
      server: Mcp.ServerName.make("acme"),
      name: "raw_name",
      title: "Display title",
      annotations: { title: "legacy" },
      inputSchema: { type: "object" },
      icons: [{ src: "https://example.test/image" }],
      serverInfo: { name: "acme", version: "1", icons: [icon] },
    }),
  ).toEqual({ schemaVersion: 1, label: "Display title", icon: { ...icon, mimeType: "image/png" } })
  expect(
    McpTool.presentation({
      server: Mcp.ServerName.make("acme"),
      name: "raw_name",
      annotations: { title: "legacy" },
      inputSchema: { type: "object" },
    }).label,
  ).toBe("legacy")
})

test("direct progress survives terminal hooks, failures in display callbacks and late callbacks", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      const hooks = yield* PluginHooks.Service
      let executions = 0
      let late: Tool.Context["progress"] | undefined
      yield* tools.transform((editor) =>
        editor.add({
          name: "write",
          description: "Write once",
          input: {},
          output: Schema.String,
          options: { codemode: false },
          execute: (_, context) =>
            Effect.gen(function* () {
              executions += 1
              late = context.progress
              yield* context.progress({
                toolPresentation: {
                  schemaVersion: 1,
                  label: "Write record",
                  detail: "Accepted",
                  icon: { src: "data:image/png;base64,iVBORw0KGgo=" },
                },
              })
              return { output: "canonical" }
            }),
        }),
      )
      yield* hooks.register("tool", "execute.after", (event) =>
        Effect.sync(() => {
          if (event.status === "completed")
            event.result = {
              ...event.result,
              metadata: {
                ...event.result.metadata,
                toolPresentation: {
                  schemaVersion: 1,
                  ...ToolPresentation.read(event.result.metadata),
                  detail: "Finished",
                },
              },
            }
        }),
      )
      const snapshot = yield* tools.snapshot()
      const result = yield* execute(snapshot, "write", {}, () => Effect.die("display failure"))
      expect(result.output).toBe("canonical")
      expect(ToolPresentation.read(result.metadata)).toMatchObject({
        label: "Write record",
        detail: "Finished",
        icon: { mimeType: "image/png" },
      })
      if (late) yield* late({ toolPresentation: { schemaVersion: 1, label: "late" } })
      expect(executions).toBe(1)
      expect(ToolPresentation.read(result.metadata)?.label).toBe("Write record")
    }).pipe(Effect.scoped, Effect.provide(layer)),
  ))

test("Code Mode isolates identical parallel calls and captures after-hook presentation before JSON output", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      const hooks = yield* PluginHooks.Service
      const release = yield* Deferred.make<void>()
      let executions = 0
      const snapshots: Tool.Metadata[] = []
      yield* tools.transform((editor) =>
        editor.add({
          name: "same",
          description: "Same input",
          input: Schema.Struct({}),
          output: Schema.String,
          execute: (_, context) =>
            Effect.gen(function* () {
              const index = executions++
              yield* context.progress({
                toolPresentation: { schemaVersion: 1, label: `Operation ${index}`, detail: "Running" },
                secret: "excluded",
                nonJson: 1n,
              })
              if (index === 0) yield* Deferred.await(release)
              return { output: `value-${index}`, metadata: { secret: "excluded", nonJson: 1n } }
            }),
        }),
      )
      yield* hooks.register("tool", "execute.after", (event) =>
        Effect.sync(() => {
          if (event.tool === "same" && event.status === "completed")
            event.result = {
              ...event.result,
              metadata: {
                ...event.result.metadata,
                toolPresentation: {
                  schemaVersion: 1,
                  ...ToolPresentation.read(event.result.metadata),
                  detail: "Finished",
                },
              },
            }
        }),
      )
      const snapshot = yield* tools.snapshot()
      const result = yield* execute(
        snapshot,
        "execute",
        { code: "return await Promise.all([tools.same({}), tools.same({})])" },
        (update) =>
          Effect.gen(function* () {
            snapshots.push(structuredClone(update))
            const rows = update.toolCalls as Array<{ status: string }>
            if (rows?.[1]?.status === "completed") yield* Deferred.succeed(release, undefined)
          }),
      )
      const rows = result.metadata?.toolCalls as Array<{ id: string; metadata: Tool.Metadata; status: string }>
      expect(rows.map((row) => row.id)).toEqual(["call_presentation/0", "call_presentation/1"])
      expect(rows.map((row) => ToolPresentation.read(row.metadata))).toEqual([
        { schemaVersion: 1, label: "Operation 0", detail: "Finished" },
        { schemaVersion: 1, label: "Operation 1", detail: "Finished" },
      ])
      expect(rows.every((row) => Object.keys(row.metadata).join() === "toolPresentation")).toBe(true)
      expect(result.content).toEqual([{ type: "text", text: '[\n  "value-0",\n  "value-1"\n]' }])
      expect(
        snapshots.some(
          (update) => update.toolCalls[0]?.status === "running" && update.toolCalls[1]?.status === "completed",
        ),
      ).toBe(true)
      expect(executions).toBe(2)
    }).pipe(Effect.scoped, Effect.provide(layer)),
  ))

test("Code Mode retains bounded error presentation while keeping canonical error text", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      yield* tools.transform((editor) =>
        editor.add({
          name: "fails",
          description: "Fails",
          input: {},
          execute: (_, context) =>
            context.progress({ toolPresentation: { schemaVersion: 1, label: "Failing action" } }).pipe(
              Effect.andThen(
                new Tool.Error({
                  message: "canonical failure",
                  metadata: { toolPresentation: { schemaVersion: 1, detail: "Refused" }, secret: "excluded" },
                }),
              ),
            ),
        }),
      )
      const snapshot = yield* tools.snapshot()
      const result = yield* execute(snapshot, "execute", { code: "await tools.fails({})" })
      expect(result.metadata?.error).toBe(true)
      expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("canonical failure") })
      expect(result.metadata?.toolCalls[0]).toMatchObject({
        id: "call_presentation/0",
        status: "error",
        metadata: { toolPresentation: { schemaVersion: 1, label: "Failing action", detail: "Refused" } },
      })
    }).pipe(Effect.scoped, Effect.provide(layer)),
  ))

for (const isError of [false, true])
  test(`MCP adapter preserves the result envelope and progress without trusting result meta (isError=${isError})`, async () => {
    const order: string[] = []
    const meta = { toolPresentation: { schemaVersion: 1, label: "forged" }, vendorNote: "server private data" }
    const mcp = Layer.mock(Mcp.Service, {
      tools: () =>
        Effect.succeed([
          {
            server: Mcp.ServerName.make("acme"),
            name: "lookup",
            title: "Lookup documents",
            codemode: false,
            inputSchema: { type: "object" },
          },
        ]),
      callTool: (input) =>
        Effect.gen(function* () {
          order.push("bridge")
          for (const update of [
            { progress: 3, message: "Reading documents" },
            { progress: 4, total: 2, message: "Invalid total must be ignored" },
            { progress: 2, message: "Retrograde progress must be ignored" },
            { progress: 5, total: 8, message: "Checking documents" },
          ]) {
            input.onProgress?.(update)
            yield* Effect.yieldNow
          }
          return {
            server: Mcp.ServerName.make("acme"),
            tool: "lookup",
            isError,
            structured: { untouched: true },
            content: [{ type: "text" as const, text: "canonical" }],
            meta,
          }
        }),
    })
    const isolated = AppNodeBuilder.build(LayerNode.group([Tool.node, McpTool.node]), [
      Mcp.node.replace(mcp),
      Permission.node.replace(
        Layer.mock(Permission.Service, {
          assert: () =>
            Effect.sync(() => {
              order.push("permission")
            }),
        }),
      ),
      Bus.node.replace(Layer.mock(Bus.Service, { subscribe: () => Stream.never })),
    ])
    await Effect.runPromise(
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        const registered = yield* McpTool.Service
        yield* registered.flush
        const snapshot = yield* tools.snapshot()
        const observed: ToolPresentation.Info[] = []
        const invocation = execute(snapshot, "acme_lookup", { original: true }, (update) =>
          Effect.sync(() => {
            const presentation = ToolPresentation.read(update)
            if (presentation?.label === "Lookup documents") order.push("presentation")
            if (presentation?.progress) observed.push(presentation)
          }),
        )
        const result = yield* isError ? invocation.pipe(Effect.flip) : invocation
        expect(result.metadata?.mcp).toEqual({ resultMeta: meta })
        expect(ToolPresentation.read(result.metadata)).toMatchObject({
          label: "Lookup documents",
          detail: "Checking documents",
          progress: { current: 5, total: 8 },
        })
        expect(observed.map((presentation) => [presentation.progress?.current, presentation.detail])).toEqual([
          [3, "Reading documents"],
          [5, "Checking documents"],
        ])
        expect(order.slice(0, 3)).toEqual(["presentation", "permission", "bridge"])
        if (isError) expect(result).toMatchObject({ message: "canonical" })
        if (!isError)
          expect(result).toMatchObject({ output: { untouched: true }, content: [{ type: "text", text: "canonical" }] })
      }).pipe(Effect.scoped, Effect.provide(isolated)),
    )
  })

test("early return settles pending child rows and ignores late child progress", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      const started = yield* Deferred.make<void>()
      let late: Tool.Context["progress"] | undefined
      let executions = 0
      const updates: Tool.Metadata[] = []
      yield* tools.transform((editor) => {
        editor.add({
          name: "pending",
          description: "Pending",
          input: {},
          execute: (_, context) =>
            Effect.gen(function* () {
              executions += 1
              late = context.progress
              yield* context.progress({ toolPresentation: { schemaVersion: 1, label: "Pending operation" } })
              yield* Deferred.succeed(started, undefined)
              return yield* Effect.never
            }),
        })
        editor.add({
          name: "barrier",
          description: "Ensure child started",
          input: {},
          output: Schema.String,
          execute: () => Deferred.await(started).pipe(Effect.as({ output: "started" })),
        })
      })
      const snapshot = yield* tools.snapshot()
      const result = yield* execute(
        snapshot,
        "execute",
        { code: 'tools.pending({}); await tools.barrier({}); return "early"' },
        (update) =>
          Effect.sync(() => {
            updates.push(update)
          }),
      )
      expect(result.content).toEqual([{ type: "text", text: "early" }])
      expect(result.metadata?.toolCalls[0]).toMatchObject({
        status: "error",
        metadata: { toolPresentation: { label: "Pending operation" } },
      })
      const count = updates.length
      if (late) yield* late({ toolPresentation: { schemaVersion: 1, detail: "late" } })
      expect(updates).toHaveLength(count)
      expect(executions).toBe(1)
    }).pipe(Effect.scoped, Effect.provide(layer)),
  ))

test("outer interruption settles the last published child snapshot", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      const started = yield* Deferred.make<void>()
      let late: Tool.Context["progress"] | undefined
      const updates: Tool.Metadata[] = []
      yield* tools.transform((editor) =>
        editor.add({
          name: "pending",
          description: "Pending",
          input: {},
          execute: (_, context) =>
            Effect.gen(function* () {
              late = context.progress
              yield* context.progress({ toolPresentation: { schemaVersion: 1, label: "Pending operation" } })
              yield* Deferred.succeed(started, undefined)
              return yield* Effect.never
            }),
        }),
      )
      const snapshot = yield* tools.snapshot()
      const fiber = yield* execute(snapshot, "execute", { code: "await tools.pending({})" }, (update) =>
        Effect.sync(() => {
          updates.push(update)
        }),
      ).pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)
      expect(updates.at(-1)?.toolCalls[0]).toMatchObject({
        status: "error",
        metadata: { toolPresentation: { label: "Pending operation" } },
      })
      const count = updates.length
      if (late) yield* late({ toolPresentation: { schemaVersion: 1, detail: "late" } })
      expect(updates).toHaveLength(count)
    }).pipe(Effect.scoped, Effect.provide(layer)),
  ))
