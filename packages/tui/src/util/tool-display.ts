export function canonicalToolName(name: string) {
  if (name === "bash") return "shell"
  if (name === "task") return "subagent"
  if (name === "apply_patch") return "patch"
  return name
}

export function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return
  return value
}

export function primitiveInputSummary(input: Record<string, unknown>, omit: readonly string[] = []) {
  const entries = Object.entries(input).filter(([key, value]) => {
    if (omit.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (entries.length === 0) return ""
  return `[${entries.map(([key, value]) => `${key}=${String(value)}`).join(", ")}]`
}

export type ExecuteCall = {
  id?: string
  tool: string
  status: "running" | "completed" | "error"
  input?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export function executeCalls(value: unknown): ExecuteCall[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((call) => {
    if (!isRecord(call)) return []
    const tool = call.tool
    const status = call.status
    if (typeof tool !== "string" || (status !== "running" && status !== "completed" && status !== "error")) return []
    return [
      {
        tool,
        status,
        input: isRecord(call.input) ? call.input : undefined,
        ...(typeof call.id === "string" && call.id ? { id: call.id } : {}),
        ...(isRecord(call.metadata) ? { metadata: call.metadata } : {}),
      },
    ]
  })
}

export function executeCallSummary(call: ExecuteCall) {
  const args = primitiveInputSummary(call.input ?? {}).replace(/\s+/g, " ")
  return toolPresentationSummary(call.metadata, `${call.tool}${args ? ` ${args}` : ""}`)
}

export function executeCallKey(call: ExecuteCall, index: number) {
  return call.id ? `id:${call.id}` : `legacy:${index}`
}

export function toolPresentationSummary(metadata: unknown, fallback: string) {
  const presentation = ToolPresentation.read(metadata)
  if (!presentation) return fallback
  return [
    presentation.label ?? fallback,
    presentation.detail,
    presentation.progress &&
      `${presentation.progress.current}${presentation.progress.total === undefined ? "" : ` / ${presentation.progress.total}`}`,
  ]
    .filter((value) => value !== undefined)
    .join(" · ")
}

export function webSearchProviderName(provider: unknown) {
  if (typeof provider !== "string" || !provider) return ""
  if (provider === "opencode") return "OpenCode"
  return `${provider[0].toUpperCase()}${provider.slice(1)}`
}

export function webSearchProviderLabel(provider: unknown) {
  const name = webSearchProviderName(provider)
  return name ? `Web Search via ${name}` : "Web Search"
}

export function toolDisplayMetadata(state: unknown): Record<string, unknown> {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {}
  if (!("status" in state) || state.status === "streaming") return {}
  if (!("metadata" in state) || !state.metadata || typeof state.metadata !== "object") return {}
  if (Array.isArray(state.metadata)) return {}
  return state.metadata as Record<string, unknown>
}

export function toolDisplayContent(state: SessionMessageAssistantTool["state"]) {
  if (state.status === "streaming" || state.status === "running") return []
  return state.content ?? []
}

export function nonEmptyToolContent<T>(content: ReadonlyArray<T> | undefined): [T, ...T[]] | undefined {
  if (!content) return undefined
  const [first, ...rest] = content
  return first === undefined ? undefined : [first, ...rest]
}
import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import { isRecord } from "./record"
import { ToolPresentation } from "@opencode/util/tool-presentation"
