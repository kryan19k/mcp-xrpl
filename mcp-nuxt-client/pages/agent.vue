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

<style scoped>
.chat-container {
    max-width: 900px;
    margin: 0 auto;
    padding: var(--space-4);
    animation: fadeIn var(--transition-slow);
    display: flex;
    flex-direction: column;
    height: 90vh;
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
}

h1 {
    font-size: 2rem;
    font-weight: 800;
    margin-bottom: var(--space-6);
    background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    text-align: center;
    position: relative;
}

h1::after {
    content: '';
    position: absolute;
    bottom: -8px;
    left: 0;
    width: 100%;
    height: 2px;
    background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
}

.chat-window {
    flex-grow: 1;
    overflow-y: auto;
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    background: var(--dark-card);
    border-radius: var(--border-radius-lg);
    box-shadow: var(--shadow-lg);
    border: 1px solid var(--dark-border);
    position: relative;
    overflow-y: auto;
    margin-bottom: var(--space-4);
}

.chat-window::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, 
        rgba(99, 102, 241, 0.03) 0%, 
        rgba(99, 102, 241, 0.01) 50%, 
        rgba(139, 92, 246, 0.03) 100%);
    opacity: 0.7;
    pointer-events: none;
    z-index: -1;
}

.chat-window::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 3px;
    background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
    z-index: 1;
}

.message {
    padding: var(--space-3) var(--space-4);
    border-radius: var(--border-radius);
    max-width: 85%;
    word-wrap: break-word;
    display: flex;
    flex-direction: column;
    position: relative;
}

.message .role {
    font-weight: 600;
    margin-bottom: var(--space-1);
    font-size: 0.85rem;
    color: var(--gray-400);
}

.message .content {
    margin: 0;
    white-space: pre-wrap;
    font-family: inherit;
    font-size: 0.95rem;
    line-height: 1.5;
}

.message-user {
    background: rgba(99, 102, 241, 0.1);
    border: 1px solid rgba(99, 102, 241, 0.2);
    align-self: flex-end;
    color: var(--gray-200);
}

.message-assistant {
    background: rgba(31, 41, 55, 0.6);
    border: 1px solid rgba(139, 92, 246, 0.2);
    align-self: flex-start;
    color: var(--gray-200);
}

.message-user .role {
    color: var(--primary-light);
}

.message-assistant .role {
    color: var(--accent-light);
}

.message-loading {
    align-self: center;
    background: transparent;
    border: none;
}

.message-loading span {
    color: var(--gray-400);
    font-style: italic;
    padding: var(--space-2);
    opacity: 0.8;
}

.message-error span {
    color: var(--danger);
    font-weight: 600;
    background: rgba(239, 68, 68, 0.1);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--border-radius);
    border: 1px solid rgba(239, 68, 68, 0.2);
}

.input-area {
    display: flex;
    padding: var(--space-3);
    gap: var(--space-2);
    background: rgba(31, 41, 55, 0.6);
    border-radius: var(--border-radius);
    border: 1px solid var(--dark-border);
}

.input-area input {
    flex: 1;
    background: rgba(31, 41, 55, 0.3);
    border: 1px solid rgba(99, 102, 241, 0.2);
    border-radius: var(--border-radius);
    padding: var(--space-3) var(--space-4);
    color: var(--gray-200);
    font-size: 0.95rem;
    transition: all var(--transition-fast);
}

.input-area input:focus {
    outline: none;
    border-color: rgba(99, 102, 241, 0.4);
    box-shadow: var(--glow-primary);
}

.input-area input::placeholder {
    color: var(--gray-400);
}

.input-area input:disabled {
    opacity: 0.7;
    cursor: not-allowed;
}

.input-area button {
    background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
    color: white;
    border: none;
    padding: var(--space-2) var(--space-5);
    border-radius: var(--border-radius);
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition);
    position: relative;
    overflow: hidden;
}

.input-area button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.input-area button:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md), var(--glow-primary);
}

/* Confirmation Modal Styles */
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.7);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
}

.modal-content {
    background: var(--dark-card);
    border-radius: var(--border-radius-lg);
    box-shadow: var(--shadow-xl);
    padding: var(--space-6);
    max-width: 700px;
    width: 90%;
    border: 1px solid var(--dark-border);
    position: relative;
}

.modal-content h3 {
    font-size: 1.5rem;
    margin-bottom: var(--space-4);
    color: var(--gray-200);
    text-align: center;
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--dark-border);
}

.modal-content h4 {
    font-size: 1.1rem;
    margin-bottom: var(--space-2);
    color: var(--gray-300);
}

.tool-details {
    background: rgba(99, 102, 241, 0.05);
    border-radius: var(--border-radius);
    padding: var(--space-4);
    margin-bottom: var(--space-4);
    border-left: 3px solid var(--primary);
}

.confirmation-container {
    margin: var(--space-4) 0;
}

.confirmation-message {
    background: rgba(31, 41, 55, 0.6);
    border-radius: var(--border-radius);
    padding: var(--space-4);
    min-height: 100px;
    max-height: 200px;
    overflow-y: auto;
    border: 1px solid var(--dark-border);
}

.confirmation-text {
    margin: 0;
    white-space: pre-wrap;
    font-family: inherit;
    font-size: 0.95rem;
    line-height: 1.5;
    color: var(--gray-200);
}

.modal-buttons {
    display: flex;
    justify-content: center;
    gap: var(--space-4);
    margin-top: var(--space-6);
}

.confirm-button, .cancel-button {
    padding: var(--space-2) var(--space-5);
    border-radius: var(--border-radius);
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition);
    font-size: 0.95rem;
}

.confirm-button {
    background: linear-gradient(135deg, var(--success) 0%, var(--success-dark) 100%);
    color: white;
    border: none;
}

.confirm-button:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md), 0 0 15px rgba(74, 222, 128, 0.5);
}

.cancel-button {
    background: rgba(239, 68, 68, 0.1);
    color: var(--danger);
    border: 1px solid var(--danger);
}

.cancel-button:hover {
    background: rgba(239, 68, 68, 0.2);
    transform: translateY(-2px);
}

.confirm-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
}

@media (max-width: 768px) {
    .chat-container {
        padding: var(--space-2);
        height: 100vh;
    }
    
    .message {
        max-width: 95%;
    }
}
</style>