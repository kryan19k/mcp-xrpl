<template>
    <div class="agent-container">
        <!-- Loading state -->
        <div v-if="isLoading && !showConfirmationModal && chatHistory.length === 0" class="loading-container">
            <div class="loading-circle">
                <div class="loading-spinner"></div>
                <div class="loading-text">Initializing AI Agent...</div>
            </div>
            <p class="loading-message">Connecting to XRPL Network</p>
        </div>

        <!-- AI Chat Dashboard -->
        <div v-else class="agent-dashboard">
            <div class="agent-header">
                <h1 class="agent-title">AI Banking Assistant</h1>
                <div class="wallet-decoration">
                    <div class="decoration-circle"></div>
                    <div class="decoration-circle"></div>
                    <div class="decoration-circle"></div>
                </div>
                <button @click="navigateTo('/wallet')" class="back-button">
                    <span class="button-icon">🏦</span>
                    <span>Back to Dashboard</span>
                </button>
            </div>
            
            <!-- Chat Interface Card -->
            <div class="chat-card dashboard-card">
                <div class="card-header">
                    <h3><span class="card-icon">🤖</span> XRPL AI Agent</h3>
                </div>
                <div class="chat-window" ref="chatWindow">
                    <!-- Welcome message if no history -->
                    <div v-if="chatHistory.length === 0" class="welcome-message">
                        <div class="welcome-icon">🧠</div>
                        <h3>Welcome to your AI Banking Assistant</h3>
                        <p>Ask me anything about XRPL, transactions, or account management. I can help you manage your finances and execute blockchain operations.</p>
                        <div class="suggestion-chips">
                            <button @click="usePrompt('What is my current XRP balance?')" class="suggestion-chip">Check my balance</button>
                            <button @click="usePrompt('How can I send XRP to another account?')" class="suggestion-chip">Transfer XRP</button>
                            <button @click="usePrompt('What can you do as my AI agent?')" class="suggestion-chip">Agent capabilities</button>
                        </div>
                    </div>
                    
                    <!-- Chat messages -->
                    <div
                        v-for="(msg, index) in chatHistory"
                        :key="index"
                        :class="['message', `message-${msg.role}`]"
                    >
                        <div class="message-avatar">
                            <span v-if="msg.role === 'user'">👤</span>
                            <span v-else>🤖</span>
                        </div>
                        <div class="message-content">
                            <div class="message-header">
                                <span class="message-author">{{ msg.role === "user" ? "You" : "AI Agent" }}</span>
                            </div>
                            <pre class="message-text">{{ msg.content }}</pre>
                        </div>
                    </div>
                    
                    <!-- Loading indicator within chat -->
                    <div v-if="isLoading && !showConfirmationModal && chatHistory.length > 0" class="message message-loading">
                        <div class="message-avatar">
                            <span>🤖</span>
                        </div>
                        <div class="message-content">
                            <div class="loading-dots">
                                Thinking<span>.</span><span>.</span><span>.</span>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Error message -->
                    <div v-if="error" class="message message-error">
                        <span>Error: {{ error }}</span>
                    </div>
                </div>
                
                <!-- Input area -->
                <div class="input-area">
                    <input
                        v-model="currentQuery"
                        placeholder="Ask your banking assistant..."
                        @keyup.enter="sendMessage"
                        :disabled="isLoading"
                    />
                    <button @click="sendMessage" :disabled="isLoading || !currentQuery" class="send-button">
                        <span class="button-icon">📤</span>
                    </button>
                </div>
            </div>
        </div>

        <!-- Confirmation Modal -->
        <div v-if="showConfirmationModal" class="modal-overlay">
            <div class="modal-content">
                <h3>Confirm Operation</h3>

                <div class="tool-details">
                    <h4>Tool: {{ toolToConfirmDetails?.name || "Loading..." }}</h4>
                </div>

                <!-- Enhanced confirmation message box -->
                <div class="confirmation-container">
                    <h4>Confirmation:</h4>
                    <div class="confirmation-message">
                        <pre class="confirmation-text">{{ streamingConfirmation }}</pre>
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
    </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted } from "vue";
import { navigateTo } from 'nuxt/app';

// Define the structure for a chat message based on Anthropic's format
interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}

// Chat state
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

// Check if user is authenticated
onMounted(async () => {
    // Check if user has a wallet
    try {
        const userDataStr = localStorage.getItem('webauthn_user');
        if (!userDataStr) {
            navigateTo('/');
            return;
        }
        
        // Show initial loading state briefly
        isLoading.value = true;
        setTimeout(() => {
            isLoading.value = false;
        }, 1500);
        
    } catch (error) {
        console.error('Error checking authentication:', error);
    }
});

// Function to use a predefined prompt
function usePrompt(prompt: string) {
    currentQuery.value = prompt;
}

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
        console.error(
            "Caught error object in sendMessage:",
            JSON.stringify(err, null, 2)
        );
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
        ].content += `\n\n[Operation cancelled by user: ${
            toolToConfirmDetails.value?.name || "Unknown operation"
        }]`;
    } else {
        // Fallback: Add as a new message
        chatHistory.value.push({
            role: "assistant",
            content: `[Operation cancelled by user: ${
                toolToConfirmDetails.value?.name || "Unknown operation"
            }]`,
        });
    }

    toolToConfirmDetails.value = null; // Clear confirmation details
    isLoading.value = false; // Stop loading indicator
    scrollToBottom();
};
</script>

<style scoped>
/* Agent Dashboard Styles - Matches wallet.vue styles */
.agent-container {
  max-width: 900px;
  margin: 0 auto;
  padding: var(--space-4);
  animation: fadeIn var(--transition-slow);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Loading animation */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  gap: var(--space-4);
  color: var(--gray-300);
}

.loading-circle {
  position: relative;
  width: 120px;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.loading-spinner {
  width: 120px;
  height: 120px;
  border: 4px solid rgba(99, 102, 241, 0.1);
  border-radius: 50%;
  border-top-color: var(--primary);
  border-left-color: var(--accent);
  animation: spin 1.5s ease-in-out infinite;
  box-shadow: var(--glow-primary);
  position: absolute;
}

.loading-text {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--primary-light);
  position: relative;
  text-align: center;
}

.loading-message {
  margin-top: var(--space-4);
  color: var(--gray-400);
  font-size: 1rem;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { opacity: 0.6; }
  50% { opacity: 1; }
  100% { opacity: 0.6; }
}

.agent-dashboard {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.agent-header {
  position: relative;
  margin-bottom: var(--space-2);
  text-align: center;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.agent-title {
  font-size: 2rem;
  font-weight: 800;
  background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  position: relative;
  z-index: 2;
  flex: 1;
  text-align: center;
}

/* Decorative elements */
.wallet-decoration {
  position: absolute;
  top: -10px;
  right: 100px;
  display: flex;
  gap: var(--space-2);
  opacity: 0.5;
  z-index: 1;
}

.decoration-circle {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--primary);
  opacity: 0.3;
  animation: pulse 3s infinite alternate ease-in-out;
}

.decoration-circle:nth-child(2) {
  background: var(--accent);
  animation-delay: 0.5s;
}

.decoration-circle:nth-child(3) {
  background: var(--primary-light);
  animation-delay: 1s;
}

.back-button {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: rgba(99, 102, 241, 0.1);
  color: var(--primary-light);
  border: 1px solid var(--primary);
  border-radius: var(--border-radius);
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all var(--transition);
}

.back-button:hover {
  background: rgba(99, 102, 241, 0.2);
  transform: translateY(-2px);
}

.dashboard-card {
  background: var(--dark-card);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-lg);
  padding: var(--space-6);
  transition: all var(--transition);
  border: 1px solid var(--dark-border);
  position: relative;
  overflow: hidden;
  backdrop-filter: var(--backdrop-blur);
  -webkit-backdrop-filter: var(--backdrop-blur);
}

.dashboard-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: 
    linear-gradient(135deg, 
      rgba(99, 102, 241, 0.03) 0%, 
      rgba(99, 102, 241, 0.01) 50%, 
      rgba(139, 92, 246, 0.03) 100%);
  opacity: 0.7;
  pointer-events: none;
  z-index: -1;
}

.dashboard-card::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 3px;
  background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
  z-index: 1;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-4);
  position: relative;
}

.card-header h3 {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--gray-200);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.card-icon {
  opacity: 0.9;
  font-size: 1.2rem;
}

/* Chat specific styles */
.chat-card {
  display: flex;
  flex-direction: column;
  height: calc(85vh - 100px);
  min-height: 500px;
}

.chat-window {
  flex-grow: 1;
  overflow-y: auto;
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  background: rgba(31, 41, 55, 0.4);
  border-radius: var(--border-radius);
  margin-bottom: var(--space-4);
}

/* Welcome message styles */
.welcome-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: var(--space-6);
  gap: var(--space-4);
  color: var(--gray-300);
}

.welcome-icon {
  font-size: 3rem;
  animation: float 6s infinite ease-in-out;
  filter: drop-shadow(0 0 8px rgba(99, 102, 241, 0.5));
}

.welcome-message h3 {
  font-size: 1.5rem;
  margin: var(--space-2) 0;
  background: linear-gradient(90deg, var(--primary-light) 0%, var(--accent-light) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.welcome-message p {
  max-width: 80%;
  line-height: 1.6;
}

.suggestion-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: center;
  margin-top: var(--space-4);
}

.suggestion-chip {
  background: rgba(99, 102, 241, 0.1);
  color: var(--primary-light);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 30px;
  padding: var(--space-2) var(--space-4);
  font-size: 0.9rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.suggestion-chip:hover {
  background: rgba(99, 102, 241, 0.2);
  transform: translateY(-2px);
}

/* Chat messages */
.message {
  display: flex;
  gap: var(--space-3);
  max-width: 100%;
  animation: fadeIn 0.3s ease-out;
}

.message-avatar {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: var(--border-radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.3rem;
}

.message-user .message-avatar {
  background: rgba(99, 102, 241, 0.1);
}

.message-assistant .message-avatar {
  background: rgba(139, 92, 246, 0.1);
}

.message-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.message-header {
  display: flex;
  justify-content: space-between;
}

.message-author {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--gray-400);
}

.message-time {
  font-size: 0.7rem;
  color: var(--gray-400);
}

.message-text {
  margin: 0;
  padding: var(--space-3);
  border-radius: var(--border-radius);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 0.95rem;
  line-height: 1.5;
}

.message-user .message-text {
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.2);
  color: var(--gray-200);
}

.message-assistant .message-text {
  background: rgba(31, 41, 55, 0.6);
  border: 1px solid rgba(139, 92, 246, 0.2);
  color: var(--gray-200);
}

/* Loading message */
.message-loading {
  opacity: 0.7;
}

.loading-dots {
  padding: var(--space-3);
  color: var(--gray-400);
  font-style: italic;
}

.loading-dots span {
  display: inline-block;
  animation: dots 1.5s infinite;
  opacity: 0;
}

.loading-dots span:nth-child(1) {
  animation-delay: 0s;
}

.loading-dots span:nth-child(2) {
  animation-delay: 0.3s;
}

.loading-dots span:nth-child(3) {
  animation-delay: 0.6s;
}

@keyframes dots {
  0% { opacity: 0; }
  50% { opacity: 1; }
  100% { opacity: 0; }
}

/* Error message */
.message-error {
  align-self: center;
  color: var(--danger);
  background: rgba(239, 68, 68, 0.1);
  padding: var(--space-3) var(--space-6);
  border-radius: var(--border-radius);
  border: 1px solid rgba(239, 68, 68, 0.2);
  font-size: 0.9rem;
}

/* Input area */
.input-area {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-3);
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

.send-button {
  background: rgba(99, 102, 241, 0.2);
  color: var(--primary-light);
  border: none;
  width: 42px;
  height: 42px;
  border-radius: var(--border-radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.send-button:hover {
  background: rgba(99, 102, 241, 0.4);
  transform: translateY(-2px);
}

.send-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.button-icon {
  font-size: 1.2rem;
}

/* Modal Styles */
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

/* Animation */
@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes float {
  0% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
  100% { transform: translateY(0); }
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .agent-header {
    flex-direction: column;
    gap: var(--space-4);
  }
  
  .agent-title {
    margin-bottom: var(--space-2);
  }
  
  .chat-card {
    height: calc(80vh - 150px);
  }
  
  .welcome-message p {
    max-width: 100%;
  }
}

@media (max-width: 576px) {
  .message {
    flex-direction: column;
  }
  
  .message-avatar {
    align-self: flex-start;
  }
  
  .modal-content {
    width: 95%;
    padding: var(--space-4);
  }
}
</style>
