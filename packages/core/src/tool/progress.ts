export * as ToolProgress from "./progress.js"

import type { Tool } from "@opencode/schema/tool"
import { ToolPresentation } from "@opencode/util/tool-presentation"
import { Cause, Effect } from "effect"

/** Only the display callback is fail-open. Execution/permission defects still propagate. */
export const publish = (context: Tool.Context, update: Tool.Metadata) =>
  Effect.suspend(() => context.progress(update)).pipe(
    Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.void)),
  )

export function merge(previous: Tool.Metadata | undefined, next: Tool.Metadata | undefined): Tool.Metadata | undefined {
  if (previous === undefined && next === undefined) return
  const before = dataProperties(previous)
  const after = dataProperties(next)
  const metadata = { ...before, ...after }
  const current = ToolPresentation.read(after)
  if (Object.hasOwn(after, "toolPresentation") && !current) return metadata
  const presentation = ToolPresentation.read({ toolPresentation: { ...ToolPresentation.read(before), ...current } })
  if (presentation) return { ...metadata, toolPresentation: presentation }
  return metadata
}

function dataProperties(value: Tool.Metadata | undefined): Tool.Metadata {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    // Spread invokes getters. Metadata is producer-owned, so copy only enumerable data slots.
    return Object.fromEntries(
      Object.entries(Object.getOwnPropertyDescriptors(value)).flatMap(([key, descriptor]) =>
        descriptor.enumerable && "value" in descriptor ? [[key, descriptor.value]] : [],
      ),
    )
  } catch {
    // A hostile container may refuse introspection; it must not alter execution.
    return {}
  }
}
