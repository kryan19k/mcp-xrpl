import { Groq } from "groq-sdk";
import { Anthropic } from "@anthropic-ai/sdk";
import type {
    MessageParam,
    Tool,
    MessageStreamEvent,
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
import * as dotenv from "dotenv"; // Added for direct env access

// Load environment variables directly (alongside Nuxt's mechanism)
dotenv.config();

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
        // Check if script path changed - rudimentary check
        // A better check would store the path used during connection
        // For now, assume it's the same if instance exists.
        console.log("Reusing existing MCP client instance for chat");
        // If tools are already fetched, return immediately
        if (serverTools.length > 0) return mcpClientInstance;
        // Otherwise, try listTools again on the existing instance
        try {
            console.log("Existing MCP instance found, re-fetching tools...");
            const toolsResult = await mcpClientInstance.listTools();
            // Store in original Anthropic format for now
            serverTools = toolsResult.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema,
            }));
            console.log(
                "Re-fetched tools (Anthropic format):",
                serverTools.map(({ name }) => name)
            );
            return mcpClientInstance;
        } catch (e) {
            console.error(
                "Failed to listTools on existing instance, will reconnect:",
                e
            );
            // Reset instance to force reconnection below
            await mcpClientInstance.close().catch(console.error); // Attempt graceful close
            mcpClientInstance = null;
            mcpTransportInstance = null;
            serverTools = [];
        }
    }

    console.log("No active/valid MCP client instance found, connecting...");
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
        name: "mcp-nuxt-client-chat",
        version: "1.0.0",
    });

    try {
        console.log(`Attempting to connect transport for: ${serverScriptPath}`);
        mcpClientInstance.connect(mcpTransportInstance);
        console.log("Transport connected. Attempting listTools...");

        const toolsResult = await mcpClientInstance.listTools();
        // Store in original Anthropic format for now
        serverTools = toolsResult.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema,
        }));
        console.log(
            "Connected to server with tools (Anthropic format):",
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

// --- LLM Clients ---
// Initialize as null
let anthropic: Anthropic | null = null; // Still needed for confirmTool potentially
let groq: Groq | null = null; // Added Groq client

export default defineEventHandler(async (event) => {
    // Initialize LLM clients if not already done
    if (!groq) {
        // Get Groq API key directly from environment (not through Nuxt runtime config)
        const groqKey = process.env.GROQ_API_KEY;
        if (!groqKey) {
            console.error("GROQ_API_KEY missing in environment variables");
            throw new Error("Groq API key not configured.");
        }
        groq = new Groq({ apiKey: groqKey });
        console.log("Groq client initialized with key from direct env.");

        // For Anthropic, still use Nuxt's approach
        const config = useRuntimeConfig(event);
        const anthropicKey = config.anthropicApiKey;
        if (anthropicKey) {
            anthropic = new Anthropic({ apiKey: String(anthropicKey) });
            console.log("Anthropic client initialized.");
        } else {
            console.warn(
                "ANTHROPIC_API_KEY missing - confirmTool might fail if it relies on this init."
            );
        }
    }

    const body = await readBody(event);
    const { query, history } = body;

    if (!query) {
        throw new Error("Missing query in request body");
    }

    let mcpClient: Client;
    const MCP_SERVER_PATH = "../mcp-server/build/index.js"; // Use the same hardcoded path

    try {
        mcpClient = await getMcpClient(MCP_SERVER_PATH);
    } catch (error: any) {
        console.error("MCP Connection Error in chat:", error);
        throw new Error(`Failed to connect to MCP server: ${error.message}`);
    }

    if (!mcpClient) {
        throw new Error("MCP client not initialized in chat.");
    }
    if (!groq) {
        throw new Error("Groq client not initialized.");
    }
    if (!anthropic) {
        throw new Error("Anthropic client not initialized.");
    }

    const messages: MessageParam[] = [...(history || [])];
    // Ensure last message has 'user' role if needed, Groq expects user/assistant roles.
    // Assuming history is valid. If history is empty, this is the first message.
    if (
        messages.length === 0 ||
        messages[messages.length - 1].role !== "user"
    ) {
        messages.push({ role: "user", content: query });
    } else {
        // If last message was user, append content (might happen with retries?) - adjust as needed
        // Or replace last message if it's a duplicate query? Simpler: assume query is new user turn.
        messages.push({ role: "user", content: query });
    }

    // TRUNCATE CONVERSATION HISTORY IF TOO LONG
    // Keep only the last 10 messages maximum to stay within context limits
    const truncatedMessages =
        messages.length > 10
            ? [...messages.slice(messages.length - 10)]
            : messages;

    console.log(
        `Using ${truncatedMessages.length} of ${messages.length} total messages`
    );

    // Filter tools based on relevance to the query (basic keyword matching)
    const getRelevantTools = (
        query: string,
        allTools: Tool[],
        maxTools: number = 8
    ): Tool[] => {
        // Simple relevance calculation based on tool name and description
        const toolsWithRelevance = allTools.map((tool) => {
            // Convert to lowercase for case-insensitive matching
            const queryLower = query.toLowerCase();
            const nameLower = tool.name.toLowerCase();

            // Check if query terms appear in the tool name
            // More sophisticated approaches could use embeddings/semantic search
            const relevance = queryLower.split(/\s+/).reduce((score, term) => {
                // Direct name match gets highest priority
                if (nameLower.includes(term)) return score + 10;
                // Description match gets lower priority
                if (tool.description?.toLowerCase().includes(term))
                    return score + 5;
                return score;
            }, 0);

            return { tool, relevance };
        });

        // Sort by relevance and take top N tools
        return toolsWithRelevance
            .sort((a, b) => b.relevance - a.relevance)
            .slice(0, maxTools)
            .map((item) => item.tool);
    };

    // Get a subset of most relevant tools rather than sending all 40+ tools
    const filteredTools = getRelevantTools(query, serverTools, 8);
    console.log(
        `Using ${filteredTools.length} most relevant tools out of ${serverTools.length} total tools`
    );
    console.log(
        "Selected tools:",
        filteredTools.map((t) => t.name)
    );

    // Map filtered tools (Anthropic format) to Groq format
    const groqTools: Groq.Chat.Completions.ChatCompletionTool[] | undefined =
        filteredTools.length > 0
            ? filteredTools.map((tool) => {
                  // Normalize the schema to ensure compatibility
                  const parameters = { ...tool.input_schema };

                  // Ensure required fields is an array if present
                  if (
                      parameters.required &&
                      !Array.isArray(parameters.required)
                  ) {
                      parameters.required = [];
                  }

                  // Handle any potential compatibility issues
                  if (!parameters.type) {
                      parameters.type = "object";
                  }

                  // Ensure properties exists
                  if (!parameters.properties) {
                      parameters.properties = {};
                  }

                  return {
                      type: "function",
                      function: {
                          name: tool.name,
                          description:
                              tool.description || `Function to ${tool.name}`,
                          parameters: parameters,
                      },
                  };
              })
            : undefined;

    // Set headers for streaming
    setResponseHeader(event, "Content-Type", "text/event-stream");
    setResponseHeader(event, "Cache-Control", "no-cache");
    setResponseHeader(event, "Connection", "keep-alive");

    console.log(
        "Sending initial query to Groq for streaming:",
        JSON.stringify(truncatedMessages, null, 2)
    );
    if (groqTools) {
        console.log(
            "Using tools (Groq format):",
            JSON.stringify(
                groqTools.map((t) => t.function.name),
                null,
                2
            )
        );
    }

    try {
        // First, use Anthropic for the initial chat - this is our primary model for XRPL interaction
        const stream = await anthropic.messages.create({
            model: "claude-3-haiku-20240307",
            max_tokens: 2048,
            messages: truncatedMessages,
            tools: serverTools.length > 0 ? serverTools : undefined,
            stream: true,
        });

        const readableStream = new ReadableStream({
            async start(controller) {
                let toolToConfirm: {
                    name: string;
                    input: any;
                    id: string;
                } | null = null;
                let accumulatedJsonString: string = "";
                let currentToolIndex: number | null = null;
                let assistantMessageContent: (
                    | string
                    | { type: string; name?: string; input?: any; id?: string }
                )[] = [];
                let fullResponseText = "";

                try {
                    for await (const event of stream) {
                        // --- Text Delta ---
                        if (
                            event.type === "content_block_delta" &&
                            event.delta.type === "text_delta"
                        ) {
                            const textChunk = event.delta.text;
                            fullResponseText += textChunk;
                            // Only stream text chunk if we are NOT inside a tool_use block
                            if (currentToolIndex === null) {
                                controller.enqueue(
                                    `data: ${JSON.stringify({
                                        type: "chunk",
                                        content: textChunk,
                                    })}\n\n`
                                );
                            }
                            assistantMessageContent.push(textChunk); // Store raw text
                        }
                        // --- Tool Use Start ---
                        else if (
                            event.type === "content_block_start" &&
                            event.content_block.type === "tool_use"
                        ) {
                            // Now correctly check content_block type
                            console.log(
                                "Tool use block started:",
                                event.content_block
                            );
                            currentToolIndex = event.index;
                            toolToConfirm = {
                                name: event.content_block.name,
                                id: event.content_block.id,
                                input: {},
                            };
                            accumulatedJsonString = "";
                            // Store the tool block structure
                            assistantMessageContent.push({
                                type: "tool_use",
                                id: event.content_block.id,
                                name: event.content_block.name,
                                input: {},
                            });
                        }
                        // --- Tool Use Input Delta ---
                        else if (
                            event.type === "content_block_delta" &&
                            event.index === currentToolIndex && // Ensure it's for the current tool
                            event.delta.type === "input_json_delta"
                        ) {
                            console.log(
                                "Tool input delta received:",
                                event.delta.partial_json
                            );
                            // Append the partial JSON string.
                            // NOTE: This simple concatenation is NOT a robust way to handle JSON deltas.
                            // A real implementation needs a proper JSON streaming parser/patcher.
                            accumulatedJsonString += event.delta.partial_json;
                        }
                        // --- Tool Use Stop ---
                        else if (
                            event.type === "content_block_stop" &&
                            event.index === currentToolIndex
                        ) {
                            currentToolIndex = null;
                            // If we successfully gathered tool details, send confirmation event
                            if (toolToConfirm) {
                                // Attempt to parse the final accumulated JSON string
                                let finalInput = {};
                                try {
                                    // Use the accumulated string for parsing
                                    finalInput = JSON.parse(
                                        accumulatedJsonString
                                    );
                                } catch (e) {
                                    console.error(
                                        "Failed to parse final accumulated tool input JSON:",
                                        accumulatedJsonString,
                                        e
                                    );
                                    // Send error or handle differently? For now, proceed with empty input.
                                }
                                toolToConfirm.input = finalInput;

                                // Update the stored message content with final input
                                const toolMsgIndex =
                                    assistantMessageContent.findIndex(
                                        (m) =>
                                            typeof m === "object" &&
                                            (m as any).id === toolToConfirm?.id
                                    );
                                if (toolMsgIndex !== -1) {
                                    (
                                        assistantMessageContent[
                                            toolMsgIndex
                                        ] as any
                                    ).input = finalInput;
                                }

                                // *** NEW: Generate a confirmation prompt with Groq ***
                                try {
                                    // Only proceed if groq is initialized
                                    if (groq) {
                                        // Call Groq to generate a confirmation message WITHOUT streaming
                                        const confirmationResponse =
                                            await groq.chat.completions.create({
                                                model: "llama3-8b-8192", // Smaller model is fine for confirmation
                                                messages: [
                                                    {
                                                        role: "system",
                                                        content:
                                                            "You generate brief, direct warnings for XRPL blockchain operations. ALWAYS START with 'Are you sure you want to' followed by a clear description of the action and its impact. ALWAYS end with a question mark. Keep to 1-2 sentences maximum.",
                                                    },
                                                    {
                                                        role: "user",
                                                        content: `The user is about to perform this XRPL action: ${
                                                            toolToConfirm.name
                                                        }. The parameters are: ${JSON.stringify(
                                                            toolToConfirm.input,
                                                            null,
                                                            2
                                                        )}. Generate a clear, direct confirmation message. Always start with "Are you sure you want to" and end with a question mark.`,
                                                    },
                                                ],
                                                max_tokens: 100, // Reduced token limit for more focused output
                                                temperature: 0.1, // Low temperature for consistent output
                                                stream: false, // Disabled streaming
                                            });

                                        // Get the confirmation text directly from the response
                                        const confirmationText =
                                            confirmationResponse.choices[0]
                                                ?.message?.content ||
                                            `Are you sure you want to proceed with ${toolToConfirm.name} operation on the XRPL network?`;

                                        console.log(
                                            "Generated confirmation via Groq (non-streaming):",
                                            confirmationText
                                        );

                                        // Build history up to this point for the confirmation endpoint
                                        messages.push({
                                            role: "assistant",
                                            content:
                                                assistantMessageContent as any,
                                        });

                                        const historyForConfirmation = [
                                            ...messages,
                                        ];

                                        // Send single complete confirmation event (no progress events)
                                        controller.enqueue(
                                            `data: ${JSON.stringify({
                                                type: "confirm",
                                                details: {
                                                    name: toolToConfirm.name,
                                                    input: toolToConfirm.input,
                                                    id: toolToConfirm.id,
                                                    messagesHistory:
                                                        historyForConfirmation,
                                                    initialAssistantText:
                                                        fullResponseText,
                                                    confirmationText:
                                                        confirmationText,
                                                },
                                            })}\n\n`
                                        );
                                        controller.close(); // Stop this stream
                                        return; // Exit loop
                                    } else {
                                        // Fallback if Groq isn't available
                                        console.log(
                                            "Groq not initialized, using default confirmation"
                                        );
                                        messages.push({
                                            role: "assistant",
                                            content:
                                                assistantMessageContent as any,
                                        });
                                        const historyForConfirmation = [
                                            ...messages,
                                        ];

                                        // For consistency, send a single confirmation message without streaming
                                        const defaultConfirmation = `Are you sure you want to proceed with ${toolToConfirm.name} operation on the XRPL network?`;

                                        // Send direct confirmation without progress events
                                        controller.enqueue(
                                            `data: ${JSON.stringify({
                                                type: "confirm",
                                                details: {
                                                    name: toolToConfirm.name,
                                                    input: toolToConfirm.input,
                                                    id: toolToConfirm.id,
                                                    messagesHistory:
                                                        historyForConfirmation,
                                                    initialAssistantText:
                                                        fullResponseText,
                                                    confirmationText:
                                                        defaultConfirmation,
                                                },
                                            })}\n\n`
                                        );
                                        controller.close();
                                        return;
                                    }
                                } catch (groqError) {
                                    // If Groq fails, fall back to a basic confirmation
                                    console.error(
                                        "Error generating confirmation with Groq:",
                                        groqError
                                    );

                                    messages.push({
                                        role: "assistant",
                                        content: assistantMessageContent as any,
                                    });
                                    const historyForConfirmation = [
                                        ...messages,
                                    ];

                                    // Error fallback - use simple confirmation
                                    const errorFallbackConfirmation = `Are you sure you want to proceed with ${toolToConfirm.name} operation on the XRPL network?`;

                                    // Send direct confirmation without streaming
                                    controller.enqueue(
                                        `data: ${JSON.stringify({
                                            type: "confirm",
                                            details: {
                                                name: toolToConfirm.name,
                                                input: toolToConfirm.input,
                                                id: toolToConfirm.id,
                                                messagesHistory:
                                                    historyForConfirmation,
                                                initialAssistantText:
                                                    fullResponseText,
                                                confirmationText:
                                                    errorFallbackConfirmation,
                                            },
                                        })}\n\n`
                                    );
                                    controller.close();
                                    return;
                                }
                            }
                        }
                        // --- Stream End ---
                        else if (event.type === "message_stop") {
                            if (!toolToConfirm) {
                                // Only complete normally if no tool confirmation was triggered
                                const finalAssistantMessage: MessageParam = {
                                    role: "assistant",
                                    content: fullResponseText, // Use accumulated text
                                };
                                const finalHistory = [
                                    ...messages,
                                    finalAssistantMessage,
                                ];
                                controller.enqueue(
                                    `data: ${JSON.stringify({
                                        type: "history",
                                        content: finalHistory,
                                    })}\n\n`
                                );
                            }
                            controller.close();
                            return; // Exit loop
                        }
                    }
                } catch (streamError) {
                    console.error(
                        "Error processing Anthropic stream in chat:",
                        streamError
                    );
                    controller.enqueue(
                        `data: ${JSON.stringify({
                            type: "error",
                            content: "Stream processing error",
                        })}\n\n`
                    );
                    controller.error(streamError);
                }
            },
        });

        return sendStream(event, readableStream);
    } catch (error: any) {
        console.error("Error calling Anthropic API:", error);
        throw new Error(`API request failed: ${error.message}`);
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
