import { expect, test } from "bun:test"
import { Server, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server"
import { McpClient } from "@opencode/core/mcp/client"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Effect } from "effect"
import { hostEnvironmentLayer } from "./fixture/environment"

for (const isError of [false, true]) test(`MCP progress/result metadata survive the client boundary (isError=${isError})`, async () => {
  const server = new Server({ name: "acme", version: "1", icons: [{ src: "data:image/png;base64,iVBORw0KGgo=" }] }, { capabilities: { tools: {} } })
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() })
  server.setRequestHandler("tools/list", async () => ({ tools: [{ name: "lookup", title: "Lookup documents", inputSchema: { type: "object" } }] }))
  server.setRequestHandler("tools/call", async (request, context) => {
    const progressToken = request.params._meta?.progressToken
    if (progressToken !== undefined) {
      await server.notification({ method: "notifications/progress", params: { progressToken, progress: 1, message: "Reading documents" } }, { relatedRequestId: context.mcpReq.id })
      await server.notification({ method: "notifications/progress", params: { progressToken, progress: 2, total: 3, message: "Checking documents" } }, { relatedRequestId: context.mcpReq.id })
    }
    return { content: [{ type: "text", text: "canonical" }], structuredContent: { original: true }, isError, _meta: { vendor: { detail: "completed", toolPresentation: "cannot overwrite host" } } }
  })
  await server.connect(transport)
  const http = Bun.serve({ port: 0, fetch: request => transport.handleRequest(request) })
  try {
    await Effect.runPromise(Effect.gen(function* () {
      const connection = yield* McpClient.connect("acme", new ConfigMCP.Remote({ type: "remote", url: http.url.toString(), oauth: false }), import.meta.dir)
      const updates: McpClient.Progress[] = []
      const result = yield* connection.callTool({ name: "lookup", onProgress: update => { updates.push(update); if (update.progress === 1) throw new Error("display failed") } })
      expect(updates.map(update => [update.progress, update.message])).toEqual([[1, "Reading documents"], [2, "Checking documents"]])
      expect(result).toEqual({ isError, structured: { original: true }, content: [{ type: "text", text: "canonical" }], meta: { vendor: { detail: "completed", toolPresentation: "cannot overwrite host" } } })
      expect(connection.serverInfo?.icons).toHaveLength(1)
      expect((yield* connection.tools())[0]?.title).toBe("Lookup documents")
    }).pipe(Effect.scoped, Effect.provide(hostEnvironmentLayer)))
  } finally {
    await server.close()
    await http.stop(true)
  }
})
