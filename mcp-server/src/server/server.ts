import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Create server instance
export const server = new McpServer({
    name: "xrpl-mcp-server",
    version: "1.0.0",
    capabilities: {
        resources: {},
        tools: {},
    },
});
