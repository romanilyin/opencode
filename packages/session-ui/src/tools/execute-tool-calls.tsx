import { createMemo, For, Show } from "solid-js"
import { useI18n } from "@opencode/ui/context/i18n"
import { Icon } from "@opencode/ui/icon"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { ToolPresentationDetails, ToolPresentationIcon } from "../components/tool-presentation"
import { executeCalls } from "./execute-calls"

export function ExecuteToolCalls(props: { metadata: Record<string, unknown> }) {
  const i18n = useI18n()
  const calls = createMemo(() => executeCalls(props.metadata.toolCalls))
  return (
    <Show when={calls().length}>
      <div data-component="execute-tool-calls" role="list">
        <For each={calls().map((call) => call.key)}>
          {(key) => {
            const call = createMemo(() => calls().find((call) => call.key === key)!)
            return (
              <div role="listitem" data-tool-call-id={call().id ?? key} data-status={call().status}>
                <div data-slot="execute-tool-call-header">
                  <Icon
                    name={
                      call().status === "error"
                        ? "outline-hexagonal-warning"
                        : call().status === "completed"
                          ? "check"
                          : "mcp"
                    }
                  />
                  <ToolPresentationIcon icon={call().presentation?.icon} />
                  <span data-slot="execute-tool-call-label">
                    <TextShimmer
                      text={call().presentation?.label ?? call().tool}
                      active={call().status === "running"}
                    />
                  </span>
                  <span data-slot="execute-tool-call-status">{i18n.t(`ui.tool.presentation.${call().status}`)}</span>
                </div>
                <ToolPresentationDetails presentation={call().presentation} />
                <Show when={call().presentation?.label && call().presentation?.label !== call().tool}>
                  <code data-slot="execute-tool-call-name">{call().tool}</code>
                </Show>
                <Show when={call().input !== undefined}>
                  <code data-slot="execute-tool-call-input">{JSON.stringify(call().input)}</code>
                </Show>
              </div>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
