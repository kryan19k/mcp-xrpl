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
                <span>Thinking...</span>
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
            <p>{{ toolToConfirmDetails.name }}</p>
            <pre>{{ toolToConfirmDetails.initialAssistantText }}</pre>
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
    if (
        !currentQuery.value.trim() ||
        isLoading.value
        // REMOVED: !serverPath.value.trim()
    )
        return;

    const userQuery = currentQuery.value;
    // const currentServerPath = serverPath.value; // REMOVED

    // Add user message to history immediately
    chatHistory.value.push({ role: "user", content: userQuery });
    currentQuery.value = ""; // Clear input field
    isLoading.value = true;
    error.value = null;
    scrollToBottom();

    try {
        // Prepare history for the backend (only send what the API needs)
        // The backend will handle the full message construction for Anthropic
        const historyToSend = chatHistory.value.slice(0, -1); // Send all but the latest user message

        const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                query: userQuery,
                // serverPath: currentServerPath, // REMOVED
                history: historyToSend, // Send the history up to the previous turn
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(
                errorData.error || `HTTP error! Status: ${response.status}`
            );
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        // --- Handle Confirmation or Direct Response ---
        if (data.confirmationNeeded) {
            console.log("Confirmation required:", data.confirmationNeeded);
            // Store details needed for confirmation
            toolToConfirmDetails.value = data.confirmationNeeded;

            // Add any initial assistant text before the tool call to history for display
            if (data.confirmationNeeded.initialAssistantText) {
                chatHistory.value.push({
                    role: "assistant",
                    content: data.confirmationNeeded.initialAssistantText,
                });
            }

            // Show the confirmation modal
            showConfirmationModal.value = true;
        } else if (data.history && Array.isArray(data.history)) {
            // If no confirmation needed, update history as before
            chatHistory.value = data.history
                .filter(
                    (msg: any) =>
                        (msg.role === "user" || msg.role === "assistant") &&
                        typeof msg.content === "string"
                )
                .map((msg: any) => ({ role: msg.role, content: msg.content }));
        } else if (data.response) {
            // Fallback if only the single response is sent (older backend format)
            chatHistory.value.push({
                role: "assistant",
                content: data.response.content,
            });
        } else {
            throw new Error("Invalid response format from server");
        }
    } catch (err: any) {
        console.error("Frontend Error:", err);
        error.value = err.message || "An unknown error occurred.";
        // Keep the user message, but show error
    } finally {
        isLoading.value = false;
        scrollToBottom();
    }
};

// --- Confirmation Handling Functions ---
const handleConfirm = async () => {
    if (!toolToConfirmDetails.value) return;

    console.log("User confirmed tool:", toolToConfirmDetails.value.name);
    showConfirmationModal.value = false;
    isLoading.value = true; // Show loading indicator
    error.value = null;

    // --- Prepare for streaming response ---
    // Add a temporary assistant message to update
    const tempAssistantMessageIndex = chatHistory.value.length;
    chatHistory.value.push({
        role: "assistant",
        content: "Executing tool and waiting for response...", // Placeholder
    });
    scrollToBottom();

    try {
        const response = await fetch("/api/confirmTool", {
            // NEW ENDPOINT
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "text/event-stream", // Indicate preference for stream
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
            if (done) break;

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
        // Update the temp message with error
        chatHistory.value[
            tempAssistantMessageIndex
        ].content = `[Error: ${error.value}]`;
    } finally {
        isLoading.value = false;
        toolToConfirmDetails.value = null; // Clear confirmation details
        scrollToBottom();
    }
};

const handleCancel = () => {
    console.log("User cancelled tool:", toolToConfirmDetails.value?.name);
    showConfirmationModal.value = false;
    // Add a cancellation message to the chat
    chatHistory.value.push({
        role: "assistant",
        content: `[Tool execution cancelled by user: ${toolToConfirmDetails.value?.name}]`,
    });
    toolToConfirmDetails.value = null; // Clear confirmation details
    isLoading.value = false;
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
    border-radius: 8px;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
    max-width: 500px;
    width: 90%;
    text-align: center;
}

.modal-content h3 {
    margin-top: 0;
    margin-bottom: 15px;
    color: #333;
}

.modal-content p {
    margin-bottom: 10px;
    color: #555;
    text-align: left;
}

.modal-content pre {
    background-color: #f5f5f5;
    padding: 10px;
    border-radius: 4px;
    text-align: left;
    max-height: 200px;
    overflow-y: auto;
    border: 1px solid #ddd;
}

.modal-buttons {
    margin-top: 25px;
    display: flex;
    justify-content: space-around;
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
</style>
