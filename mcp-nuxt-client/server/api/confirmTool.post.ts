import { Anthropic } from "@anthropic-ai/sdk";
import type {
    MessageParam,
    Tool,
    ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
    defineEventHandler,
    readBody,
    setResponseHeader,
    sendStream,
} from "h3";
import { useRuntimeConfig } from "#imports"; // Nuxt auto-import

// --- MCP Client Setup (Copied from chat.post.ts - needs refactoring later) ---
// Ideally, share this logic or use a server plugin
let mcpClientInstance: Client | null = null;
let mcpTransportInstance: StdioClientTransport | null = null;

// WARNING: This reuses the global instance from chat.post.ts.
// This might lead to issues if multiple requests overlap.
// A proper solution involves better instance management (e.g., request-scoped or singleton).
async function getMcpClient(serverScriptPath: string): Promise<Client> {
    if (mcpClientInstance /* && mcpTransportInstance?.isActive() */) {
        console.log("Reusing existing MCP client instance for confirmTool");
        return mcpClientInstance;
    }

    // If instance is null, attempt to recreate it (basic recovery)
    console.log(
        "No active MCP client instance found, attempting to reconnect for confirmTool..."
    );
    if (!serverScriptPath) {
        throw new Error("Server script path is required to connect.");
    }
    const isJs = serverScriptPath.endsWith(".js");
    const command = isJs ? process.execPath : "python3"; // Simplified

    console.log(`Connecting to MCP server: ${command} ${serverScriptPath}`);
    mcpTransportInstance = new StdioClientTransport({
        command,
        args: [serverScriptPath],
    });
    mcpClientInstance = new Client({
        name: "mcp-nuxt-client-confirm",
        version: "1.0.0",
    });

    try {
        mcpClientInstance.connect(mcpTransportInstance);
        // We don't listTools here, assuming chat.post.ts established the connection
        // and the necessary tools are implicitly known/available.
        console.log(
            `Connected MCP client for confirmTool using ${serverScriptPath}`
        );
    } catch (e) {
        console.error("Failed to connect MCP client in confirmTool:", e);
        mcpClientInstance = null;
        mcpTransportInstance = null;
        throw e; // Re-throw
    }
    return mcpClientInstance;
}

// Utility function to extract transaction hash from tool result
function extractTransactionHash(result: any): string | null {
    // If result is already an object (not a string)
    if (
        typeof result !== "string" &&
        result !== null &&
        typeof result === "object"
    ) {
        // It could be an array of objects with text property
        if (Array.isArray(result)) {
            for (const item of result) {
                if (item?.text && typeof item.text === "string") {
                    const hashFromText = extractHashFromString(item.text);
                    if (hashFromText) return hashFromText;
                }
                // It might contain a hash property directly
                if (item?.hash) return item.hash;
                if (item?.transaction_hash) return item.transaction_hash;
                if (item?.txHash) return item.txHash;
            }
            return null;
        }

        // Check for common hash property names in the object
        return result.hash || result.transaction_hash || result.txHash || null;
    }

    // Handle string input (either JSON or plain text)
    return extractHashFromString(result);
}

// Helper to extract hash from string content
function extractHashFromString(text: string): string | null {
    if (!text) return null;

    try {
        // Try to parse as JSON first
        const parsed = JSON.parse(text);
        return extractTransactionHash(parsed);
    } catch {
        // If not JSON, try regex patterns
        // Common hash format in text (64 hex chars)
        const hashRegex = /hash['":\s]+([0-9A-Fa-f]{64})/i;
        const match = text.match(hashRegex);
        return match ? match[1] : null;
    }
}

// --- Anthropic Client ---
let anthropic: Anthropic | null = null; // Initialize as null

export default defineEventHandler(async (event) => {
    // Initialize Anthropic client
    if (!anthropic) {
        const config = useRuntimeConfig(event);
        const apiKey = config.anthropicApiKey;
        if (!apiKey) {
            console.error("ANTHROPIC_API_KEY missing in confirmTool");
            throw new Error("Anthropic API key not configured.");
        }
        anthropic = new Anthropic({ apiKey });
    }

    const body = await readBody(event);
    const { name, input, id: tool_use_id, messagesHistory } = body;

    if (!name || !input || !tool_use_id || !messagesHistory) {
        throw new Error("Missing required fields in confirmation request.");
    }

    let mcpClient: Client;
    const MCP_SERVER_PATH = "../mcp-server/build/index.js"; // Use the same hardcoded path

    try {
        mcpClient = await getMcpClient(MCP_SERVER_PATH);
    } catch (error: any) {
        console.error("MCP Connection Error in confirmTool:", error);
        throw new Error(`Failed to connect to MCP server: ${error.message}`);
    }

    if (!mcpClient) {
        throw new Error("MCP client not initialized in confirmTool.");
    }

    // Set header for streaming response
    setResponseHeader(event, "Content-Type", "text/event-stream");
    setResponseHeader(event, "Cache-Control", "no-cache");
    setResponseHeader(event, "Connection", "keep-alive");

    // We need a way to handle errors *within* the stream if they occur late
    // For now, initial errors throw before streaming starts

    // Execute the tool call *before* starting the stream
    console.log(`Executing confirmed tool: ${name}`, input);
    let toolResultContent: string;
    let isErrorResult = false;
    try {
        const result = await mcpClient.callTool({
            name,
            arguments: input as Record<string, unknown> | undefined,
        });
        console.log(`Tool ${name} result:`, result);
        toolResultContent =
            typeof result.content === "string"
                ? result.content
                : JSON.stringify(result.content);
    } catch (toolError: any) {
        console.error(`Error calling tool ${name}:`, toolError);
        toolResultContent = `Error executing tool: ${toolError.message}`;
        isErrorResult = true;
        // Consider sending an error event through the stream if needed later
    }

    // Process the tool result content to ensure it's properly formatted for Anthropic
    let processedContent: any = toolResultContent;
    // If it looks like a JSON string, try to parse it
    if (
        typeof toolResultContent === "string" &&
        (toolResultContent.startsWith("[") || toolResultContent.startsWith("{"))
    ) {
        try {
            processedContent = JSON.parse(toolResultContent);
        } catch (e) {
            console.log("Failed to parse tool result as JSON, using as string");
            // Keep as string if parsing fails
        }
    }

    const toolResultBlock: ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id,
        content: processedContent,
        is_error: isErrorResult || undefined,
    };

    const messagesForFinalCall: MessageParam[] = [
        ...messagesHistory,
        {
            role: "user",
            content: [toolResultBlock],
        },
    ];

    console.log(
        "Sending tool result to Anthropic for streaming:",
        JSON.stringify(messagesForFinalCall, null, 2)
    );

    try {
        const stream = await anthropic.messages.create({
            // model: "claude-3-5-sonnet-20240620",
            model: "claude-3-haiku-20240307",
            max_tokens: 1024,
            messages: messagesForFinalCall,
            stream: true, // ENABLE STREAMING
        });

        // Use ReadableStream and pipe chunks
        const readableStream = new ReadableStream({
            async start(controller) {
                let fullResponseText = ""; // Keep track for history
                try {
                    // Extract transaction hash from tool result before streaming
                    const transactionHash =
                        extractTransactionHash(toolResultContent) || "N/A";

                    // Add hash notice at the beginning
                    const hashPrefix = `Transaction hash: ${transactionHash}\n\n`;
                    controller.enqueue(
                        `data: ${JSON.stringify({
                            type: "chunk",
                            content: hashPrefix,
                        })}\n\n`
                    );
                    fullResponseText += hashPrefix;

                    for await (const event of stream) {
                        if (
                            event.type === "content_block_delta" &&
                            event.delta.type === "text_delta"
                        ) {
                            const textChunk = event.delta.text;
                            fullResponseText += textChunk;
                            // Send chunk to client as data event
                            controller.enqueue(
                                `data: ${JSON.stringify({
                                    type: "chunk",
                                    content: textChunk,
                                })}\n\n`
                            );
                        } else if (event.type === "message_stop") {
                            // Optionally send the full history back in a final event
                            const finalAssistantMessage: MessageParam = {
                                role: "assistant",
                                content: fullResponseText,
                            };
                            const finalHistory = [
                                ...messagesForFinalCall,
                                finalAssistantMessage,
                            ];
                            controller.enqueue(
                                `data: ${JSON.stringify({
                                    type: "history",
                                    content: finalHistory,
                                })}\n\n`
                            );
                            controller.close(); // Close the stream
                        }
                    }
                } catch (streamError) {
                    console.error(
                        "Error processing Anthropic stream:",
                        streamError
                    );
                    // Send an error event and close
                    controller.enqueue(
                        `data: ${JSON.stringify({
                            type: "error",
                            content: "Stream processing error",
                        })}\n\n`
                    );
                    controller.error(streamError); // Close stream with error
                }
            },
        });

        return sendStream(event, readableStream);
    } catch (error: any) {
        console.error(
            "Anthropic API Error during stream creation in confirmTool:",
            error
        );
        // Need to handle this error without returning JSON if headers are set
        // Maybe return an empty stream or a stream with just an error event?
        // For now, log and let the request likely hang or fail uncleanly.
        // A better approach would be needed for robust error handling here.
        return; // Avoid sending JSON response after setting stream headers
    }
});
