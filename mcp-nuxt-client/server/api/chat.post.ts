import { Anthropic } from "@anthropic-ai/sdk";
import type {
    MessageParam,
    Tool,
} from "@anthropic-ai/sdk/resources/messages.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { defineEventHandler, readBody } from "h3";
import { useRuntimeConfig } from "#imports"; // Nuxt auto-import

// Access the key via Nuxt's runtime config
// const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY; // Old way

// --- MCP Client Setup (Simplified) ---
// Ideally, manage this instance better (e.g., singleton, per-request with caching)
let mcpClientInstance: Client | null = null;
let mcpTransportInstance: StdioClientTransport | null = null;
let serverTools: Tool[] = [];
async function getMcpClient(serverScriptPath: string): Promise<Client> {
    // Remove explicit connection check. Rely on listTools() failure within try/catch.
    if (mcpClientInstance /* && mcpTransportInstance?.isActive() */) {
        // Consider if the serverScriptPath changed - might need re-connection logic
        // If script path is the same, assume connection is okay. listTools will verify.
        // A more robust solution would compare serverScriptPath and reconnect if different.
        return mcpClientInstance;
    }

    if (!serverScriptPath) {
        throw new Error("Server script path is required to connect.");
    }

    const isJs = serverScriptPath.endsWith(".js");
    const isPy = serverScriptPath.endsWith(".py");
    if (!isJs && !isPy) {
        throw new Error("Server script must be a .js or .py file");
    }
    const command = isPy
        ? process.platform === "win32"
            ? "python"
            : "python3"
        : process.execPath; // Use current Node executable for .js

    console.log(`Connecting to MCP server: ${command} ${serverScriptPath}`);

    mcpTransportInstance = new StdioClientTransport({
        command,
        args: [serverScriptPath],
        // Set CWD if necessary, assuming script path is relative to project root or absolute
        // cwd: process.cwd(), // Or determine based on serverScriptPath
    });

    mcpClientInstance = new Client({
        name: "mcp-nuxt-client",
        version: "1.0.0",
    });

    try {
        console.log(`Attempting to connect transport for: ${serverScriptPath}`);
        mcpClientInstance.connect(mcpTransportInstance);
        console.log("Transport connected. Attempting listTools...");

        // Event listeners removed as they caused type errors.
        // Refer to SDK documentation for correct event handling if needed.

        const toolsResult = await mcpClientInstance.listTools();
        serverTools = toolsResult.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema,
        }));
        console.log(
            "Connected to server with tools:",
            serverTools.map(({ name }) => name)
        );
        console.log("listTools successful.");
    } catch (e) {
        console.error(
            `Failed during MCP connection/handshake for ${serverScriptPath}: `,
            e
        );
        mcpClientInstance = null; // Reset on failure
        mcpTransportInstance = null;
        serverTools = [];
        throw e; // Re-throw to send error response
    }

    return mcpClientInstance;
}

// --- Anthropic Client ---
// Ensure API key is loaded before initializing
let anthropic: Anthropic | null = null; // Initialize as null

export default defineEventHandler(async (event) => {
    // Initialize Anthropic client here, inside the handler, using runtime config
    if (!anthropic) {
        const config = useRuntimeConfig(event); // Pass event for context
        const apiKey = config.anthropicApiKey;
        if (!apiKey) {
            console.error(
                "ANTHROPIC_API_KEY is not set in Nuxt runtime config"
            );
            return { error: "Anthropic API key not configured." };
        }
        anthropic = new Anthropic({ apiKey });
    }

    const body = await readBody(event);
    const { query, history } = body;

    if (!query) {
        return { error: "Missing query in request body" };
    }

    let mcpClient: Client;
    try {
        mcpClient = await getMcpClient("../mcp-server/build/index.js");
    } catch (error: any) {
        console.error("MCP Connection Error:", error);
        return { error: `Failed to connect to MCP server: ${error.message}` };
    }

    if (!mcpClient) {
        return { error: "MCP client not initialized." };
    }

    const messages: MessageParam[] = [...(history || [])]; // Include previous history
    messages.push({
        role: "user",
        content: query,
    });

    try {
        console.log("Sending to Anthropic:", JSON.stringify(messages, null, 2));
        console.log("Using tools:", JSON.stringify(serverTools, null, 2));

        const response = await anthropic.messages.create({
            // model: "claude-3-5-sonnet-20240620", // Use the specific model
            model: "claude-3-haiku-20240307", // Faster/cheaper model for testing
            max_tokens: 1024,
            messages,
            tools: serverTools.length > 0 ? serverTools : undefined, // Only send tools if available
        });

        console.log("Anthropic response:", JSON.stringify(response, null, 2));

        // --- Tool Confirmation Logic ---
        let toolToConfirm: { name: string; input: any; id: string } | null =
            null;
        let initialAssistantText = "";
        const assistantResponseContentBlocks = response.content;

        for (const content of assistantResponseContentBlocks) {
            if (content.type === "text") {
                initialAssistantText += content.text;
            } else if (content.type === "tool_use" && !toolToConfirm) {
                // Capture the *first* tool use found for confirmation
                toolToConfirm = {
                    name: content.name,
                    input: content.input,
                    id: content.id,
                };
                // We will break after finding the first tool, assuming one tool call per turn for confirmation
                // break; // Decide if we should break or collect all text first
            } else if (content.type === "tool_use" && toolToConfirm) {
                // Handle case where multiple tool_use blocks are present - currently ignored for confirmation
                console.warn(
                    "Multiple tool_use blocks received, only requesting confirmation for the first."
                );
            }
        }

        // Add the initial assistant message (text parts + tool_use requests) to history
        // This is crucial for the confirmTool endpoint to have the right context
        messages.push({
            role: "assistant",
            content: assistantResponseContentBlocks, // Keep original structured content
        });

        if (toolToConfirm) {
            // If a tool needs confirmation, return the specific structure
            console.log(
                `Requesting confirmation for tool: ${toolToConfirm.name}`,
                toolToConfirm.input
            );
            return {
                confirmationNeeded: {
                    ...toolToConfirm,
                    // Send the complete message history needed to continue the conversation
                    messagesHistory: messages,
                    // Also send any initial text the assistant provided before the tool call
                    initialAssistantText: initialAssistantText || undefined,
                },
            };
        } else {
            // If no tool use, just return the text response directly
            const finalAssistantMessage: MessageParam = {
                role: "assistant",
                content: initialAssistantText, // Only text content
            };
            return {
                response: finalAssistantMessage,
                // Append the final text-only assistant message to the history returned
                history: [...messages, finalAssistantMessage],
            };
        }

        // --- OLD Tool Execution Logic (Now moved to confirmTool endpoint) ---
        /*
        const toolResults = [];
        let assistantResponseContent = "";
        let needsFollowUp = false; // Flag to check if a tool call occurred
        // ... (rest of the old logic processing tools and calling Anthropic again)
        */
    } catch (error: any) {
        console.error("Anthropic API Error:", error);
        return { error: `Error processing query: ${error.message}` };
    }
});

// Graceful shutdown (optional but recommended)
process.on("SIGINT", async () => {
    console.log("\nShutting down MCP client...");
    if (mcpClientInstance) {
        await mcpClientInstance.close();
    }
    process.exit(0);
});

process.on("SIGTERM", async () => {
    console.log("\nShutting down MCP client...");
    if (mcpClientInstance) {
        await mcpClientInstance.close();
    }
    process.exit(0);
});
