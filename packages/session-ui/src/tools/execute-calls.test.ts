import { describe, expect, test } from "bun:test"
import { executeCalls } from "./execute-calls"

describe("execute presentation rows", () => {
  test("retains invocation identity and canonical failure across reverse completion", () => {
    const initial = executeCalls([
      {
        id: "first",
        tool: "acme.lookup",
        status: "running",
        metadata: { toolPresentation: { schemaVersion: 1, label: "First lookup", detail: "Working" } },
      },
      {
        id: "second",
        tool: "acme.lookup",
        status: "running",
        metadata: { toolPresentation: { schemaVersion: 1, label: "Second lookup" } },
      },
    ])
    const updated = executeCalls([
      {
        id: "second",
        tool: "acme.lookup",
        status: "error",
        metadata: { toolPresentation: { schemaVersion: 1, label: "Second lookup", detail: "Claims completed" } },
      },
      {
        id: "first",
        tool: "acme.lookup",
        status: "running",
        metadata: { toolPresentation: { schemaVersion: 1, label: "First lookup", progress: { current: 2, total: 4 } } },
      },
    ])
    expect(updated.map((call) => call.key)).toEqual([initial[1]!.key, initial[0]!.key])
    expect(updated[0]).toMatchObject({ id: "second", status: "error", presentation: { detail: "Claims completed" } })
    expect(updated[1]).toMatchObject({
      id: "first",
      status: "running",
      presentation: { progress: { current: 2, total: 4 } },
    })
  })

  test("keeps old history and malformed presentation usable without confusing repeated names", () => {
    expect(
      executeCalls([
        null,
        {
          tool: "acme.lookup",
          status: "completed",
          input: { name: "first" },
          metadata: { toolPresentation: { schemaVersion: 9, label: "ignore" } },
        },
        {
          tool: "acme.lookup",
          status: "error",
          input: { name: "second" },
          metadata: { toolPresentation: { schemaVersion: 1, label: {} } },
        },
        { tool: "bad", status: "unknown" },
      ]),
    ).toMatchObject([
      { key: "legacy:1", tool: "acme.lookup", status: "completed", input: { name: "first" }, presentation: undefined },
      { key: "legacy:2", tool: "acme.lookup", status: "error", input: { name: "second" }, presentation: undefined },
    ])
    expect(executeCalls({ toolCalls: [] })).toEqual([])
  })
})
