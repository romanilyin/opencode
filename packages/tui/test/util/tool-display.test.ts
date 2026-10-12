import { describe, expect, test } from "bun:test"
import {
  canonicalToolName,
  executeCalls,
  executeCallKey,
  executeCallSummary,
  finiteNumber,
  primitiveInputSummary,
  toolDisplayMetadata,
  toolPresentationSummary,
  webSearchProviderLabel,
} from "../../src/util/tool-display"

test("normalizes shared tool primitives", () => {
  expect(["bash", "task", "apply_patch", "plugin_tool"].map(canonicalToolName)).toEqual([
    "shell",
    "subagent",
    "patch",
    "plugin_tool",
  ])
  expect([finiteNumber(-1.5), finiteNumber(Number.NaN), finiteNumber("1")]).toEqual([-1.5, undefined, undefined])
  expect(primitiveInputSummary({ command: "pwd", count: 2, nested: {} })).toBe("[command=pwd, count=2]")
  expect(primitiveInputSummary({ path: "src/a.ts", line: 2 }, ["path"])).toBe("[line=2]")
})

describe("tool presentation", () => {
  test("shows safe text and progress at every state while retaining unknown metadata fallback", () => {
    expect(
      toolPresentationSummary(
        {
          toolPresentation: {
            schemaVersion: 1,
            label: "\u001b[31mLookup\u001b[0m\nready",
            detail: "Second phase",
            progress: { current: 2, total: 5 },
          },
        },
        "acme.lookup",
      ),
    ).toBe("Lookup ready · Second phase · 2 / 5")
    expect(
      toolPresentationSummary(
        { toolPresentation: { schemaVersion: 7, label: "untrusted" } },
        "acme.lookup [name=first]",
      ),
    ).toBe("acme.lookup [name=first]")
    expect(toolPresentationSummary({ toolPresentation: { schemaVersion: 1, label: {} } }, "fallback")).toBe("fallback")
  })

  test("retains IDs, arguments and canonical errors when repeated calls complete in reverse order", () => {
    const rows = executeCalls([
      {
        id: "second",
        tool: "acme.lookup",
        status: "error",
        input: { name: "second" },
        metadata: {
          toolPresentation: { schemaVersion: 1, label: "Second lookup", detail: "Completed according to label" },
        },
      },
      {
        id: "first",
        tool: "acme.lookup",
        status: "running",
        input: { name: "first" },
        metadata: { toolPresentation: { schemaVersion: 1, label: "First lookup", progress: { current: 1 } } },
      },
      { tool: "acme.lookup", status: "completed", input: { name: "old" } },
    ])
    expect(rows.map(executeCallKey)).toEqual(["id:second", "id:first", "legacy:2"])
    expect(rows[0]).toMatchObject({ id: "second", status: "error", input: { name: "second" } })
    expect(rows.map(executeCallSummary)).toEqual([
      "Second lookup · Completed according to label",
      "First lookup · 1",
      "acme.lookup [name=old]",
    ])
  })
})

describe("webSearchProviderLabel", () => {
  test("labels known providers", () => {
    expect(webSearchProviderLabel("parallel")).toBe("Web Search via Parallel")
    expect(webSearchProviderLabel("exa")).toBe("Web Search via Exa")
    expect(webSearchProviderLabel("firecrawl")).toBe("Web Search via Firecrawl")
    expect(webSearchProviderLabel("tavily")).toBe("Web Search via Tavily")
    expect(webSearchProviderLabel("opencode")).toBe("Web Search via OpenCode")
  })

  test("labels providers dynamically", () => {
    expect(webSearchProviderLabel("other")).toBe("Web Search via Other")
  })

  for (const [name, provider] of [
    ["undefined", undefined],
    ["null", null],
    ["an object", {}],
    ["an array", []],
    ["a number", 1],
    ["an empty string", ""],
  ] as const) {
    test(`uses the generic label for ${name}`, () => {
      expect(webSearchProviderLabel(provider)).toBe("Web Search")
    })
  }
})

describe("toolDisplayMetadata", () => {
  test("returns tool metadata for non-pending states", () => {
    const metadata = { provider: "parallel", numResults: 3 }

    expect(toolDisplayMetadata({ status: "running", metadata })).toBe(metadata)
    expect(toolDisplayMetadata({ status: "completed", metadata })).toBe(metadata)
    expect(toolDisplayMetadata({ status: "error", metadata })).toBe(metadata)
  })

  test("does not expose pending or malformed metadata", () => {
    expect(toolDisplayMetadata({ status: "streaming", metadata: { provider: "exa" } })).toEqual({})
    expect(toolDisplayMetadata({ status: "completed" })).toEqual({})
    expect(toolDisplayMetadata({ status: "completed", metadata: null })).toEqual({})
    expect(toolDisplayMetadata({ status: "completed", metadata: [] })).toEqual({})
    expect(toolDisplayMetadata(undefined)).toEqual({})
  })
})
