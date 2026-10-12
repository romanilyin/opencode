export * as ToolPresentation from "./tool-presentation.js"

export type Icon = { src: string; mimeType?: string }
export type Info = {
  schemaVersion: 1
  label?: string
  detail?: string
  icon?: Icon
  progress?: { current: number; total?: number }
}

/** Display text only: bounded before normalization and never evaluated as markup. */
export function text(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096) return
  const clean = value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/[\ud800-\udfff]/gu, "�")
    .replace(/\s+/g, " ")
    .trim()
  return Array.from(clean).slice(0, 160).join("") || undefined
}

/** Small inline raster icons only; rendering never fetches an MCP-supplied URL. */
export function icon(value: unknown): Icon | undefined {
  try {
    const src = field(value, "src")
    const mimeType = field(value, "mimeType")
    if (typeof src !== "string" || src.length > 44_000) return
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(src)
    if (!match || (mimeType !== undefined && mimeType !== match[1])) return
    const bytes = atob(match[2]!)
    if (bytes.length > 32 * 1024) return
    const valid = match[1] === "image/png" ? bytes.startsWith("\x89PNG\r\n\x1a\n")
      : match[1] === "image/jpeg" ? bytes.startsWith("\xff\xd8\xff")
        : bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP"
    if (!valid) return
    return { src, mimeType: match[1]! }
  } catch { return }
}

/** Reads the whole metadata container, extracting only the owned presentation DTO. */
export function read(metadata: unknown): Info | undefined {
  try {
    const value = field(metadata, "toolPresentation")
    if (field(value, "schemaVersion") !== 1) return
    const label = text(field(value, "label"))
    const detail = text(field(value, "detail"))
    const image = icon(field(value, "icon"))
    const progress = field(value, "progress")
    const current = field(progress, "current")
    const total = field(progress, "total")
    const amount = typeof current === "number" && Number.isFinite(current) && current >= 0
      && (total === undefined || typeof total === "number" && Number.isFinite(total) && total > 0 && total >= current)
      ? { current, ...(typeof total === "number" ? { total } : {}) } : undefined
    if (!label && !detail && !image && !amount) return
    return { schemaVersion: 1, ...(label ? { label } : {}), ...(detail ? { detail } : {}), ...(image ? { icon: image } : {}), ...(amount ? { progress: amount } : {}) }
  } catch { return }
}

function field(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return
  return Object.getOwnPropertyDescriptor(value, key)?.value
}
