import { ToolPresentation } from "@opencode/util/tool-presentation"

export function executeCalls(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((call, index) => {
    if (!isRecord(call)) return []
    if (
      typeof call.tool !== "string" ||
      (call.status !== "running" && call.status !== "completed" && call.status !== "error")
    )
      return []
    const id = typeof call.id === "string" && call.id ? call.id : undefined
    return [
      {
        key: id ? `id:${id}` : `legacy:${index}`,
        id,
        tool: call.tool,
        status: call.status,
        input: call.input,
        presentation: ToolPresentation.read(call.metadata),
      },
    ]
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
