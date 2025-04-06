<template>
    <div class="chat-container">
        <h1>MCP Nuxt Chat Client</h1>

        <div class="chat-window" ref="chatWindow">
            <div
                v-for="(msg, index) in chatHistory"
                :key="index"
                :class="['message', `message-${msg.role}`]"
            >
                <span class="role"
                    >{{ msg.role === "user" ? "You" : "Assistant" }}:</span
                >
                <pre class="content">{{ msg.content }}</pre>
            </div>
            <div v-if="isLoading" class="message message-loading">
                <span
                    v-if="
                        chatHistory.length > 0 &&
                        chatHistory[chatHistory.length - 1].role ===
                            'assistant' &&
                        chatHistory[chatHistory.length - 1].content
                    "
                >
                    {{ chatHistory[chatHistory.length - 1].content }}
                </span>
                <span v-else>Thinking...</span>
            </div>
            <div v-if="error" class="message message-error">
                <span>Error: {{ error }}</span>
            </div>
        </div>

        <div class="input-area">
            <input
                v-model="currentQuery"
                placeholder="Enter your query..."
                @keyup.enter="sendMessage"
                :disabled="isLoading"
            />
            <button @click="sendMessage" :disabled="isLoading || !currentQuery">
                Send
            </button>
        </div>
    </div>

    <!-- Confirmation Modal -->
    <div v-if="showConfirmationModal" class="modal-overlay">
        <div class="modal-content">
            <h3>Confirm Tool Execution</h3>

            <div class="tool-details">
                <h4>Tool: {{ toolToConfirmDetails?.name || "Loading..." }}</h4>
            </div>

            <!-- Enhanced confirmation message box -->
            <div class="confirmation-container">
                <h4>Confirmation:</h4>
                <div class="confirmation-message">
                    <pre
                        class="confirmation-text"
                        style="border: 1px dashed #ccc; padding: 8px"
                        >{{ streamingConfirmation }}</pre
                    >
                </div>
            </div>

            <div class="modal-buttons">
                <button @click="handleConfirm" class="confirm-button">
                    Confirm
                </button>
                <button @click="handleCancel" class="cancel-button">
                    Cancel
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from "vue";

// Define the structure for a chat message based on Anthropic's format
interface ChatMessage {
    role: "user" | "assistant";
    // Content can be complex (e.g., list of blocks), but we'll simplify for display
    content: string;
}

// const serverPath = ref(""); // REMOVED: Path to the MCP server script
const currentQuery = ref("");
const chatHistory = ref<ChatMessage[]>([]); // Stores the conversation history
const isLoading = ref(false);
const error = ref<string | null>(null);
const chatWindow = ref<HTMLElement | null>(null);

// --- State for Confirmation Modal ---
const showConfirmationModal = ref(false);
const toolToConfirmDetails = ref<any>(null); // Store details for the modal
const streamingConfirmation = ref(""); // Track streaming confirmation message
const confirmationComplete = ref(false); // Track if confirmation is complete
let initialStreamEnded = false; // Flag to know if initial stream closed normally or for confirmation

// --- Scroll Utility ---
const scrollToBottom = () => {
    nextTick(() => {
        if (chatWindow.value) {
            chatWindow.value.scrollTop = chatWindow.value.scrollHeight;
        }
    });
};

// --- API Call ---
const sendMessage = async () => {
    if (!currentQuery.value.trim() || isLoading.value) return;

    const userQuery = currentQuery.value;
    chatHistory.value.push({ role: "user", content: userQuery });
    currentQuery.value = ""; // Clear input field
    isLoading.value = true;
    error.value = null;
    initialStreamEnded = false; // Reset flag
    scrollToBottom();

    // Add temporary assistant message for streaming
    const tempAssistantMessageIndex = chatHistory.value.length;
    chatHistory.value.push({ role: "assistant", content: "" }); // Start empty

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "text/event-stream", // Expect stream
            },
            body: JSON.stringify({
                query: userQuery,
                history: chatHistory.value.slice(0, -2), // Send history BEFORE user query and temp message
            }),
        });

        if (!response.ok) {
            let errorMsg = `HTTP error! Status: ${response.status}`;
            try {
                const errorData = await response.json();
                errorMsg = errorData.error || errorMsg;
            } catch (e) {
                /* Ignore */
            }
            throw new Error(errorMsg);
        }

        if (
            !response.body ||
            !response.headers.get("content-type")?.includes("text/event-stream")
        ) {
            throw new Error(
                "Expected a stream but received a different content type from /api/chat."
            );
        }

        // --- Process the initial stream from /api/chat ---
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let currentAssistantContent = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                initialStreamEnded = true; // Mark that stream ended normally
                break;
            }

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");
            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const jsonData = line.substring(6);
                    try {
                        const eventData = JSON.parse(jsonData);

                        if (eventData.type === "chunk") {
                            currentAssistantContent += eventData.content;
                            chatHistory.value[
                                tempAssistantMessageIndex
                            ].content = currentAssistantContent;
                            scrollToBottom();
                        } else if (eventData.type === "confirm") {
                            // Single message confirmation handling
                            console.log(
                                "Confirmation requested:",
                                eventData.details
                            );
                            toolToConfirmDetails.value = eventData.details;
                            confirmationComplete.value = true;

                            // Set confirmation text directly from the details
                            streamingConfirmation.value =
                                eventData.details.confirmationText ||
                                `Are you sure you want to proceed with ${
                                    eventData.details.name || "this operation"
                                }?`;

                            // Update assistant message content
                            chatHistory.value[
                                tempAssistantMessageIndex
                            ].content = currentAssistantContent;

                            // Show confirmation modal
                            showConfirmationModal.value = true;

                            // Stop stream processing
                            await reader.cancel();
                            initialStreamEnded = false;
                            break;
                        } else if (eventData.type === "history") {
                            // Final history received (no tool confirmation occurred)
                            console.log(
                                "Received final history from initial stream."
                            );
                            chatHistory.value = eventData.content
                                .filter(
                                    (msg: any) =>
                                        (msg.role === "user" ||
                                            msg.role === "assistant") &&
                                        typeof msg.content === "string"
                                )
                                .map((msg: any) => ({
                                    role: msg.role,
                                    content: msg.content,
                                }));
                            initialStreamEnded = true;
                            await reader.cancel(); // Done with stream
                            break; // Exit inner loop
                        } else if (eventData.type === "error") {
                            console.error(
                                "Received error event from initial stream:",
                                eventData.content
                            );
                            error.value = eventData.content;
                            chatHistory.value[
                                tempAssistantMessageIndex
                            ].content += `\n[Stream Error: ${eventData.content}]`;
                            await reader.cancel();
                            initialStreamEnded = false;
                            break; // Exit inner loop
                        }
                    } catch (e) {
                        console.error(
                            "Failed to parse initial stream data:",
                            jsonData,
                            e
                        );
                    }
                }
            }
            // Check if we need to break outer loop (e.g., after confirm event)
            if (
                showConfirmationModal.value ||
                error.value ||
                initialStreamEnded
            )
                break;
        }
        // End of while loop
        console.log("Initial stream processing finished.");
    } catch (err: any) {
        // Add detailed logging
        console.error(
            "Caught error object in sendMessage:",
            JSON.stringify(err, null, 2)
        );
        console.error("Typeof err:", typeof err);
        if (err instanceof Error) {
            console.error("err is instance of Error");
            console.error("err.message:", err.message);
            console.error("err.stack:", err.stack);
        } else {
            console.error("err is NOT instance of Error");
        }
        // End detailed logging

        console.error("Error during initial chat / streaming:", err); // Keep original log
        // Refine error message assignment for non-standard errors
        error.value =
            err?.message ??
            (typeof err === "string" ? err : "An unknown error occurred");
        chatHistory.value[
            tempAssistantMessageIndex
        ].content = `[Error: ${error.value}]`;
    } finally {
        // Only set loading false if the stream ended normally or with error,
        // NOT if waiting for confirmation
        if (initialStreamEnded || error.value) {
            isLoading.value = false;
        }
        scrollToBottom();
    }
};

// --- Confirmation Handling Functions ---
const handleConfirm = async () => {
    if (!toolToConfirmDetails.value) return;

    console.log("User confirmed tool:", toolToConfirmDetails.value.name);
    showConfirmationModal.value = false;
    streamingConfirmation.value = "";
    confirmationComplete.value = false;
    isLoading.value = true;
    error.value = null;
    initialStreamEnded = false; // Reset flag for the *next* stream

    // Add temporary assistant message for the *second* stream
    const tempAssistantMessageIndex = chatHistory.value.length;
    chatHistory.value.push({ role: "assistant", content: "Executing tool..." });
    scrollToBottom();

    try {
        // Call the confirmTool endpoint (expects a stream response)
        const response = await fetch("/api/confirmTool", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "text/event-stream", // Expect stream
            },
            body: JSON.stringify(toolToConfirmDetails.value), // Send all details
        });

        if (!response.ok) {
            // Try to read error from body if possible, otherwise use status
            let errorMsg = `HTTP error! Status: ${response.status}`;
            try {
                const errorData = await response.json();
                errorMsg = errorData.error || errorMsg;
            } catch (e) {
                /* Ignore JSON parse error if body isn't JSON */
            }
            throw new Error(errorMsg);
        }

        // Check if response is actually a stream
        if (
            !response.body ||
            !response.headers.get("content-type")?.includes("text/event-stream")
        ) {
            // Fallback? Or handle as error? Perhaps the backend sent JSON.
            // For now, assume it's an error if we expected a stream.
            console.warn(
                "Expected a stream but received a different content type."
            );
            // Try parsing as JSON as a fallback
            const data = await response.json();
            if (data.error) {
                throw new Error(data.error);
            }
            if (data.history) {
                chatHistory.value = data.history
                    .filter(
                        (msg: any) =>
                            (msg.role === "user" || msg.role === "assistant") &&
                            typeof msg.content === "string"
                    )
                    .map((msg: any) => ({
                        role: msg.role,
                        content: msg.content,
                    }));
                // Remove the temporary message if full history was received
                // chatHistory.value.splice(tempAssistantMessageIndex, 1);
            } else {
                throw new Error(
                    "Received non-stream response with unexpected format."
                );
            }
            return; // Exit after handling non-stream response
        }

        // --- Process the stream ---
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let currentAssistantContent = "";
        chatHistory.value[tempAssistantMessageIndex].content = ""; // Clear placeholder

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                initialStreamEnded = true; // Mark confirm stream ended
                break;
            }

            const chunk = decoder.decode(value, { stream: true });
            // Process Server-Sent Event data lines
            const lines = chunk.split("\n");
            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const jsonData = line.substring(6);
                    try {
                        const eventData = JSON.parse(jsonData);
                        if (eventData.type === "chunk") {
                            currentAssistantContent += eventData.content;
                            // Update the content of the temporary message incrementally
                            chatHistory.value[
                                tempAssistantMessageIndex
                            ].content = currentAssistantContent;
                            scrollToBottom(); // Keep scrolling as content arrives
                        } else if (eventData.type === "history") {
                            // Optional: Update the entire history at the end
                            // This replaces the incrementally built message
                            console.log("Received final history.");
                            chatHistory.value = eventData.content
                                .filter(
                                    (msg: any) =>
                                        (msg.role === "user" ||
                                            msg.role === "assistant") &&
                                        typeof msg.content === "string"
                                )
                                .map((msg: any) => ({
                                    role: msg.role,
                                    content: msg.content,
                                }));
                            scrollToBottom();
                        } else if (eventData.type === "error") {
                            console.error(
                                "Received error event from stream:",
                                eventData.content
                            );
                            error.value = eventData.content;
                            // Optionally update the assistant message with the error
                            chatHistory.value[
                                tempAssistantMessageIndex
                            ].content += `\n[Stream Error: ${eventData.content}]`;
                            scrollToBottom();
                        }
                    } catch (e) {
                        console.error(
                            "Failed to parse stream data:",
                            jsonData,
                            e
                        );
                    }
                }
            }
        }

        // Ensure the final built content is set if history event wasn't used/received
        // chatHistory.value[tempAssistantMessageIndex].content = currentAssistantContent;
    } catch (err: any) {
        console.error("Error during tool confirmation / streaming:", err);
        error.value =
            err.message || "An unknown error occurred during confirmation.";
        // Update the *correct* temp message with error
        chatHistory.value[
            tempAssistantMessageIndex
        ].content = `[Error: ${error.value}]`;
    } finally {
        // Loading is now always false after confirm attempt finishes/errors
        isLoading.value = false;
        toolToConfirmDetails.value = null; // Clear confirmation details
        scrollToBottom();
    }
};

const handleCancel = () => {
    console.log("User cancelled tool:", toolToConfirmDetails.value?.name);
    showConfirmationModal.value = false;
    streamingConfirmation.value = "";
    confirmationComplete.value = false;

    // Append cancellation notice to the last assistant message
    const lastMessageIndex = chatHistory.value.length - 1;
    if (
        lastMessageIndex >= 0 &&
        chatHistory.value[lastMessageIndex].role === "assistant"
    ) {
        // Add extra newline for separation before the cancellation message
        chatHistory.value[
            lastMessageIndex
        ].content += `\n\n[Tool execution cancelled by user: ${
            toolToConfirmDetails.value?.name || "Unknown Tool"
        }]`;
    } else {
        // Fallback: Add as a new message if the last message wasn't an assistant message (unexpected)
        chatHistory.value.push({
            role: "assistant",
            content: `[Tool execution cancelled by user: ${
                toolToConfirmDetails.value?.name || "Unknown Tool"
            }]`,
        });
    }

    toolToConfirmDetails.value = null; // Clear confirmation details
    isLoading.value = false; // Stop loading indicator
    scrollToBottom();
};
</script>

<style>
body {
    font-family: sans-serif;
    margin: 0;
    background-color: #f4f4f9;
    color: #333;
}

.chat-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    max-width: 800px;
    margin: 0 auto;
    background-color: #fff;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    overflow: hidden; /* Prevents elements from spilling out */
}

h1 {
    text-align: center;
    padding: 15px;
    margin: 0;
    background-color: #5a5a8a;
    color: white;
    font-size: 1.4em;
}

.config-section {
    padding: 15px;
    border-bottom: 1px solid #eee;
    background-color: #f9f9f9;
}

.config-section label {
    display: block;
    margin-bottom: 5px;
    font-weight: bold;
}

.config-section input {
    width: calc(100% - 22px); /* Account for padding/border */
    padding: 10px;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 0.9em;
}

.config-section input:disabled {
    background-color: #eee;
    cursor: not-allowed;
}

.config-section .hint {
    font-size: 0.8em;
    color: #666;
    margin-top: 5px;
}

.chat-window {
    flex-grow: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 15px;
    background-color: #eef2f7; /* Lighter chat background */
}

.message {
    padding: 10px 15px;
    border-radius: 18px;
    max-width: 75%;
    word-wrap: break-word;
    display: flex;
    flex-direction: column;
}

.message .role {
    font-weight: bold;
    margin-bottom: 4px;
    font-size: 0.8em;
    color: #555;
}

.message .content {
    margin: 0;
    white-space: pre-wrap; /* Preserve whitespace and line breaks */
    font-family: inherit; /* Use the body font */
    font-size: 1em;
}

.message-user {
    background-color: #dcf8c6;
    align-self: flex-end;
    border-bottom-right-radius: 4px; /* Slightly different shape */
}

.message-assistant {
    background-color: #fff;
    align-self: flex-start;
    border: 1px solid #eee;
    border-bottom-left-radius: 4px; /* Slightly different shape */
}

.message-user .role {
    color: #4b830d;
}

.message-assistant .role {
    color: #444;
}

.message-loading span,
.message-error span {
    color: #888;
    font-style: italic;
    align-self: center;
    padding: 10px;
}

.message-error span {
    color: #c00;
    font-weight: bold;
}

.input-area {
    display: flex;
    padding: 15px;
    border-top: 1px solid #eee;
    background-color: #f9f9f9;
}

.input-area input {
    flex-grow: 1;
    padding: 10px;
    border: 1px solid #ccc;
    border-radius: 20px;
    margin-right: 10px;
    font-size: 1em;
}

.input-area input:disabled {
    background-color: #eee;
}

.input-area button {
    padding: 10px 20px;
    background-color: #5a5a8a;
    color: white;
    border: none;
    border-radius: 20px;
    cursor: pointer;
    font-size: 1em;
    transition: background-color 0.2s;
}

.input-area button:disabled {
    background-color: #a0a0c0;
    cursor: not-allowed;
}

.input-area button:hover:not(:disabled) {
    background-color: #48486f;
}

pre {
    white-space: pre-wrap; /* Allows text wrapping */
    word-wrap: break-word; /* Breaks long words */
}

/* --- Confirmation Modal Styles --- */
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.6);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
}

.modal-content {
    background-color: white;
    padding: 30px;
    border-radius: 12px;
    box-shadow: 0 6px 25px rgba(0, 0, 0, 0.25);
    max-width: 700px;
    width: 90%;
    text-align: center;
}

.modal-content h3 {
    margin-top: 0;
    margin-bottom: 25px;
    color: #333;
    font-size: 1.6em;
    border-bottom: 2px solid #eee;
    padding-bottom: 12px;
}

.modal-content h4 {
    text-align: left;
    color: #444;
    margin-bottom: 8px;
    font-size: 1.1em;
}

.tool-details {
    background-color: #f0f5ff;
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 20px;
    text-align: left;
    border-left: 4px solid #5a5a8a;
}

.assistant-response {
    margin-bottom: 20px;
    text-align: left;
}

.assistant-response pre {
    background-color: #f9f9f9;
    padding: 15px;
    border-radius: 6px;
    text-align: left;
    max-height: 150px;
    overflow-y: auto;
    border: 1px solid #eaeaea;
    font-size: 0.95em;
}

.confirmation-container {
    margin: 25px 0;
    text-align: left;
}

.confirmation-message {
    background-color: #f5fff5;
    padding: 18px;
    border-radius: 8px;
    margin: 8px 0 20px 0;
    text-align: left;
    min-height: 80px;
    border: 1px solid #d0e8d0;
}

.confirmation-text {
    margin: 0;
    white-space: pre-wrap;
    font-family: inherit;
    font-size: 1.05em;
    line-height: 1.6;
    color: #333;
    max-height: 200px;
    overflow-y: auto;
}

.loading-dots {
    color: #666;
    font-style: italic;
    text-align: center;
    margin-top: 20px;
}

.modal-buttons {
    margin-top: 30px;
    display: flex;
    justify-content: center;
    gap: 20px;
}

.modal-buttons button {
    padding: 10px 25px;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-size: 1em;
    transition: background-color 0.2s, box-shadow 0.2s;
}

.confirm-button {
    background-color: #4caf50; /* Green */
    color: white;
}

.confirm-button:hover {
    background-color: #45a049;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
}

.cancel-button {
    background-color: #f44336; /* Red */
    color: white;
}

.cancel-button:hover {
    background-color: #da190b;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
}

/* Add streaming confirmation styles */
.confirmation-message {
    background-color: #f5f5f5;
    padding: 15px;
    border-radius: 4px;
    margin: 15px 0;
    text-align: left;
    min-height: 60px;
    border: 1px solid #ddd;
}

.confirmation-text {
    margin: 0;
    white-space: pre-wrap;
    font-family: inherit;
    font-size: 1em;
    line-height: 1.5;
    color: #333;
    max-height: 200px;
    overflow-y: auto;
}

.loading-dots {
    color: #666;
    font-style: italic;
}

.loading-dots span {
    animation: dots 1.5s infinite;
    opacity: 0;
}

.loading-dots span:nth-child(1) {
    animation-delay: 0s;
}

.loading-dots span:nth-child(2) {
    animation-delay: 0.5s;
}

.loading-dots span:nth-child(3) {
    animation-delay: 1s;
}

@keyframes dots {
    0% {
        opacity: 0;
    }
    50% {
        opacity: 1;
    }
    100% {
        opacity: 0;
    }
}

/* Ensure the confirm button is disabled while confirmation is streaming */
.confirm-button:disabled {
    background-color: #a0c0a0;
    cursor: not-allowed;
}
</style>
