import { expect, test } from "bun:test"
import { ToolPresentation } from "../src/tool-presentation.js"

const png = { src: "data:image/png;base64,iVBORw0KGgo=" }

test("reads only the versioned bounded presentation DTO", () => {
  expect(ToolPresentation.read({ toolPresentation: { schemaVersion: 1, label: "  Build\n index\x1b[31m \u202e", detail: "observed", secret: "hidden", progress: { current: 2, total: 4 } }, unrelated: "hidden" })).toEqual({ schemaVersion: 1, label: "Build index", detail: "observed", progress: { current: 2, total: 4 } })
  expect(ToolPresentation.read({ toolPresentation: { schemaVersion: 2, label: "unknown" } })).toBeUndefined()
  expect(ToolPresentation.text("🌍".repeat(200))).toBe("🌍".repeat(160))
  expect(ToolPresentation.text("x".repeat(4097))).toBeUndefined()
})

test("never evaluates metadata or presentation accessors", () => {
  let accessed = false
  const metadata = Object.defineProperty({}, "toolPresentation", { get() { accessed = true; throw new Error("getter") } })
  expect(ToolPresentation.read(metadata)).toBeUndefined()
  expect(ToolPresentation.read(new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("proxy") } }))).toBeUndefined()
  expect(accessed).toBe(false)
})

test("accepts small inline rasters and rejects remote/SVG/oversize or mislabeled icons", () => {
  expect(ToolPresentation.icon(png)).toEqual({ ...png, mimeType: "image/png" })
  for (const value of [{ src: "https://example.test/icon.png" }, { src: "data:image/svg+xml;base64,PHN2Zz4=" }, { ...png, mimeType: "image/jpeg" }, { src: "data:image/png;base64,aHRtbA==" }, { src: `data:image/png;base64,${btoa("\x89PNG\r\n\x1a\n" + "x".repeat(32768))}` }]) expect(ToolPresentation.icon(value)).toBeUndefined()
})

test("invalid progress falls back without removing a valid label", () => {
  for (const progress of [{ current: NaN }, { current: -1 }, { current: 4, total: 3 }, { current: 1, total: 0 }]) expect(ToolPresentation.read({ toolPresentation: { schemaVersion: 1, label: "Index", progress } })).toEqual({ schemaVersion: 1, label: "Index" })
})
