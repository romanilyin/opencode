# Tool presentation metadata

Tools can provide human-readable labels without changing their model-facing name, arguments, output, permissions, or lifecycle status. This contract applies to MCP tools and plugins, including calls nested inside `execute`.

## Host contract

Presentation lives in the existing tool metadata container:

```json
{
  "toolPresentation": {
    "schemaVersion": 1,
    "label": "Checking project tests",
    "detail": "12 tests completed",
    "progress": { "current": 12, "total": 20 }
  }
}
```

All fields except `schemaVersion` are optional. Labels and details are plain text, normalized and bounded to 160 Unicode code points. Unknown versions and malformed values are ignored by renderers. The existing tool name and renderer remain the fallback.

`progress.current` must be finite and nonnegative. `total`, when supplied, must be a finite positive bound at least as large as current. Without a total, the number is an observed count, not a percentage. A producer may use a notification sequence when work has no common numeric unit; the client must not invent a maximum of 100.

An optional `icon` is `{ "src": "data:image/png;base64,...", "mimeType": "image/png" }`. The current renderer accepts small inline PNG, JPEG, or WebP images with matching signatures and a maximum decoded size of 32 KiB. Other images fall back to the existing icon. It does not fetch an MCP-supplied remote URL or execute SVG. TUI retains its terminal icon and renders the text fields.

Presentation is descriptive. A successful request can report that a background operation is still running. Labels and details never replace canonical errors, permission decisions, or status badges.

## Standard MCP mapping

At execution start the adapter publishes the descriptor's `title`, then `annotations.title`, then the original tool name. An eligible tool icon takes precedence over an eligible server icon. The standard progress callback updates detail from `message` and numeric progress from `progress` / `total`, scoped to the current invocation.

Progress state survives the terminal result and `execute.after` metadata. Updates after settlement are discarded. Optional presentation failures do not replay a call or convert successful execution to failure; interruption retains its existing meaning.

MCP result `_meta` is retained in `metadata.mcp.resultMeta`. Its keys are never spread into host metadata. The core does not interpret vendor keys or domain-specific result fields as display instructions. A plugin may explicitly validate a server's documented extension and map it to `toolPresentation` through the normal tool transform/after hooks.

## Nested calls and history

Each `execute` child row has an invocation ID independent of the tool name. Rows remain in start order, so two concurrent calls of the same tool can finish in either order without overwriting each other. The child owns its progress and final presentation; the outer `execute` owns the complete row snapshot.

Only the bounded presentation projection belongs on a child row. Arbitrary result metadata, private MCP metadata, and duplicate output bodies must not be copied into the nested machine output. Normal return values and media retain their existing delivery path.

Web and TUI render both running and final metadata, including error and collapsed views. Older history without invocation IDs or presentation metadata keeps its existing fallback. This is an additive host feature; servers need not implement any proprietary extension to benefit from standard titles and progress messages.

## Plugin guidance

- Match the intended tools explicitly; do not hijack the outer `execute` tool to guess child operations.
- Preserve the host's icon, detail, numeric progress, and unrelated metadata when setting an action-specific label.
- Keep the invocation context IDs and permission source unchanged when wrapping progress.
- Leave an unsupported presentation version owned by another producer intact.
- Treat result metadata and text as untrusted data. Validate only the documented extension you own; do not infer permission or success from a label.
- A background task that outlives the MCP request needs its own observation/task mechanism. Presentation does not extend a completed request's lifetime.
