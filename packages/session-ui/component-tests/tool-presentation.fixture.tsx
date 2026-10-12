import { render } from "solid-js/web"
import { createSignal } from "solid-js"
import { DataProvider } from "../src/context/data"
import { ToolDisplay, CurrentContextToolGroup } from "../src/tools/tool-renderer"
import type { SessionMessageAssistantTool } from "@opencode/client/promise"

const icon = {
  src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKuoAAAAASUVORK5CYII=",
  mimeType: "image/png",
}
const rows = [
  {
    id: "first",
    tool: "acme.lookup",
    status: "running",
    input: { query: "first" },
    metadata: {
      toolPresentation: {
        schemaVersion: 1,
        label: "First lookup",
        detail: "Reading",
        icon,
        progress: { current: 1, total: 4 },
      },
    },
  },
  {
    id: "second",
    tool: "acme.lookup",
    status: "running",
    input: { query: "second" },
    metadata: { toolPresentation: { schemaVersion: 1, label: "Second lookup", icon } },
  },
]

export function mountToolPresentation() {
  const host = document.createElement("section")
  host.dataset.testid = "tool-presentation-fixture"
  host.style.cssText = "width: min(720px, 100%); padding: 24px; display: flex; flex-direction: column; gap: 16px"
  document.body.appendChild(host)
  render(() => {
    const [status, setStatus] = createSignal("running")
    const [metadata, setMetadata] = createSignal<Record<string, unknown>>({
      toolPresentation: {
        schemaVersion: 1,
        label: "Reading records",
        detail: "Reading shard 2",
        icon,
        progress: { current: 2, total: 5 },
      },
    })
    const [calls, setCalls] = createSignal<unknown[]>(rows)
    const [groupOpen, setGroupOpen] = createSignal(false)
    const group: SessionMessageAssistantTool = {
      type: "tool",
      id: "group-records",
      name: "acme.lookup",
      executed: true,
      time: { created: 1, ran: 2, completed: 3 },
      state: {
        status: "completed",
        input: {},
        content: [{ type: "text", text: "Canonical group output" }],
        metadata: {
          toolPresentation: { schemaVersion: 1, label: "Grouped records", detail: "Loaded 5 records", icon },
        },
      },
    }
    return (
      <DataProvider directory="/fixture" data={{ session: [], session_status: {}, session_diff: {} }}>
        <div>
          <button
            onClick={() => {
              setStatus("completed")
              setMetadata({
                toolPresentation: { schemaVersion: 1, label: "Records loaded", detail: "5 records available", icon },
              })
            }}
          >
            Complete direct call
          </button>
          <button
            onClick={() => {
              setStatus("running")
              setMetadata({
                toolPresentation: {
                  schemaVersion: 99,
                  label: "Ignore this",
                  icon: { src: "https://invalid.example/icon.png" },
                },
              })
            }}
          >
            Malformed direct metadata
          </button>
          <button
            onClick={() => {
              setMetadata({
                toolPresentation: { schemaVersion: 1, label: "<b>Plain label</b>\n\u202e", detail: "Plain detail" },
              })
            }}
          >
            Plain text direct label
          </button>
          <button
            onClick={() =>
              setCalls([
                {
                  ...rows[1]!,
                  status: "error",
                  metadata: {
                    toolPresentation: { schemaVersion: 1, label: "Second lookup", detail: "Claims completed", icon },
                  },
                },
                {
                  ...rows[0]!,
                  metadata: {
                    toolPresentation: {
                      schemaVersion: 1,
                      label: "First lookup",
                      detail: "Reading",
                      icon,
                      progress: { current: 2, total: 4 },
                    },
                  },
                },
              ])
            }
          >
            Complete second first
          </button>
        </div>
        <div data-testid="direct">
          <ToolDisplay
            id="direct"
            tool="acme.lookup"
            input={{ query: "fixture" }}
            metadata={metadata()}
            output="Canonical direct output"
            status={status()}
          />
        </div>
        <div data-testid="count-only">
          <ToolDisplay
            id="count-only"
            tool="acme.lookup"
            input={{}}
            metadata={{
              toolPresentation: {
                schemaVersion: 1,
                label: "Following updates",
                detail: "Current phase",
                progress: { current: 8 },
              },
            }}
            status="running"
          />
        </div>
        <div data-testid="completed">
          <ToolDisplay
            id="completed"
            tool="acme.lookup"
            input={{}}
            metadata={{
              toolPresentation: { schemaVersion: 1, label: "Records available", detail: "5 records loaded", icon },
            }}
            status="completed"
            output="Canonical completed output"
          />
        </div>
        <div data-testid="failed">
          <ToolDisplay
            id="failed"
            tool="acme.lookup"
            input={{}}
            metadata={{
              toolPresentation: { schemaVersion: 1, label: "Lookup failed", detail: "Request declined", icon },
            }}
            status="error"
            error="Error: permission_denied: Original canonical error"
          />
        </div>
        <div data-testid="execute">
          <ToolDisplay
            id="execute"
            tool="execute"
            input={{
              code: "await Promise.all([tools.acme.lookup({query: 'first'}), tools.acme.lookup({query: 'second'})])",
            }}
            metadata={{ toolCalls: calls() }}
            output="Canonical execute output"
            status="running"
          />
        </div>
        <div data-testid="group">
          <CurrentContextToolGroup parts={[group]} busy={false} open={groupOpen()} onOpenChange={setGroupOpen} />
        </div>
      </DataProvider>
    )
  }, host)
}
