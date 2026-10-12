import { Show } from "solid-js"
import { ToolPresentation } from "@opencode/util/tool-presentation"
import { useI18n } from "@opencode/ui/context/i18n"

export function ToolPresentationIcon(props: { icon?: ToolPresentation.Info["icon"] }) {
  return (
    <Show when={props.icon}>
      {(icon) => (
        <img
          data-component="tool-presentation-icon"
          src={icon().src}
          alt=""
          aria-hidden="true"
          width={16}
          height={16}
        />
      )}
    </Show>
  )
}

export function ToolPresentationDetails(props: { presentation?: ToolPresentation.Info }) {
  const i18n = useI18n()
  return (
    <Show when={props.presentation?.detail || props.presentation?.progress}>
      <span data-component="tool-presentation-details">
        <Show when={props.presentation?.detail}>
          {(detail) => <span data-slot="tool-presentation-detail">{detail()}</span>}
        </Show>
        <Show when={props.presentation?.progress}>
          {(progress) => (
            <span
              data-slot="tool-presentation-progress"
              role={progress().total === undefined ? undefined : "progressbar"}
              aria-label={progress().total === undefined ? undefined : i18n.t("ui.tool.presentation.progress")}
              aria-valuemin={progress().total === undefined ? undefined : 0}
              aria-valuenow={progress().total === undefined ? undefined : progress().current}
              aria-valuemax={progress().total}
            >
              {progress().current}
              <Show when={progress().total !== undefined}> / {progress().total}</Show>
            </span>
          )}
        </Show>
      </span>
    </Show>
  )
}
