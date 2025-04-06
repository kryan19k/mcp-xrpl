<template>
  <div class="wallet-container">
    <!-- Loading state with animation -->
    <div v-if="loading" class="loading-container">
      <div class="loading-circle">
        <div class="loading-spinner"></div>
        <div class="loading-text">{{ loadingMessage || 'Loading...' }}</div>
      </div>
      <p class="loading-message">Connecting to XRPL Network and initializing AI agent</p>
    </div>

    <!-- Authentication required -->
    <div v-else-if="step === 'auth'" class="auth-card">
      <div class="auth-content flex flex-col items-center text-center">
        <div class="auth-icon">🔐</div>
        <h1>Authentication Required</h1>
        <p>Please verify your identity to access your AI banking dashboard.</p>
        <button @click="authenticate" class="primary-button">
          <span class="button-icon">🔓</span>
          <span>Authenticate</span>
          <span class="button-shine"></span>
        </button>
      </div>
    </div>

    <!-- Banking Dashboard -->
    <div v-else-if="step === 'wallet'" class="wallet-dashboard">
      <div class="wallet-header">
        <h1 class="wallet-title">AI-Powered Banking Dashboard</h1>
        <div class="wallet-decoration">
          <div class="decoration-circle"></div>
          <div class="decoration-circle"></div>
          <div class="decoration-circle"></div>
        </div>
      </div>
      
      <!-- Balance Card -->
      <div class="dashboard-grid">
        <div class="balance-card dashboard-card">
          <div class="card-header">
            <h3><span class="card-icon">💰</span> Account Balance</h3>
            <button @click="refreshBalance" class="refresh-button">
              <span class="refresh-icon">🔄</span>
            </button>
          </div>
          <div class="balance-amount">
            <div class="balance-value">{{ walletBalance }}</div>
            <div class="balance-currency">XRP</div>
          </div>
          <div class="card-footer">
            <span class="last-updated">Last updated: {{ lastRefreshed }}</span>
          </div>
        </div>
        
        <!-- Account Address Card -->
        <div class="address-card dashboard-card">
          <div class="card-header">
            <h3><span class="card-icon">🏦</span> Banking ID</h3>
          </div>
          <div class="address-box">
            <p class="font-mono">{{ userWallet?.xrplAddress }}</p>
            <button @click="copyToClipboard(userWallet?.xrplAddress)" class="copy-button">
              <span v-if="!copiedAddress" class="copy-icon">📋</span>
              <span v-else class="copied-icon">✓</span>
            </button>
          </div>
        </div>
      </div>
      
      <!-- Transactions Section -->
      <div class="transactions-section dashboard-card">
        <div class="card-header">
          <h3><span class="card-icon">📊</span> Transaction History</h3>
        </div>
        
        <div v-if="transactions.length > 0" class="transactions-list">
          <div v-for="(tx, index) in realTransactions" :key="index" class="transaction-item">
            <div class="transaction-icon">
              <span v-if="tx.type === 'Payment'" class="tx-icon payment">💸</span>
              <span v-else class="tx-icon">📝</span>
            </div>
            <div class="transaction-details">
              <div class="transaction-type">{{ tx.type }}</div>
              <div class="transaction-date">{{ formatDate(tx.date) }}</div>
            </div>
            <div class="transaction-amount" :class="{'amount-positive': tx.amount > 0}">
              {{ tx.amount ? tx.amount.toFixed(2) + ' XRP' : 'N/A' }}
            </div>
          </div>
        </div>
        
        <div v-else class="no-transactions">
          <div class="empty-state-icon">🤖</div>
          <p>Your AI assistant is ready to process your first transaction</p>
          <button @click="refreshBalance" class="secondary-button small-button">
            <span class="button-icon">🔄</span>
            <span>Refresh</span>
          </button>
        </div>
      </div>
      
      <!-- AI Assistant Card -->
      <div v-if="userWallet?.initialBalance" class="faucet-card dashboard-card">
        <div class="card-header">
          <h3><span class="card-icon">🤖</span> AI Assistant</h3>
        </div>
        <div class="faucet-info">
          <div class="faucet-icon">🧠</div>
          <div class="faucet-details">
            <p>Your account is connected to our <strong>MCP-enabled AI agent</strong> that optimizes your transactions.</p>
            <p class="faucet-note">Initial balance of <strong>{{ userWallet.initialBalance }} XRP</strong> has been allocated to your account from TestNet.</p>
          </div>
        </div>
      </div>

      <!-- Banking Actions -->
      <div class="wallet-actions">
        <button @click="refreshBalance" class="primary-button">
          <span class="button-icon">🔄</span>
          <span>Update Account</span>
          <span class="button-shine"></span>
        </button>
        <button @click="navigateTo('/')" class="secondary-button">
          <span class="button-icon">🏠</span>
          <span>Back to Home</span>
        </button>
      </div>
    </div>

    <!-- Error state -->
    <div v-else-if="step === 'error'" class="error-card">
      <div class="error-icon">⚠️</div>
      <h2 class="text-error">Error</h2>
      <p>{{ errorMessage }}</p>
      <button @click="step = 'auth'" class="secondary-button">
        <span class="button-icon">↩️</span>
        <span>Try Again</span>
        <span class="button-shine"></span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import { navigateTo } from 'nuxt/app';
// Correctly import the XRPL library
import * as xrpl from 'xrpl';

// Page state
const step = ref('auth');
const loading = ref(false);
const loadingMessage = ref('');
const errorMessage = ref('');
const userWallet = ref(null);
const WebAuthN = ref(null);
const XRPL = ref(null);
const walletBalance = ref('0.00');
const copiedAddress = ref(false);
const lastRefreshed = ref('-');

// Faucet state
const faucetMessage = ref('');
const faucetError = ref(false);

// Real transactions for display
const transactions = ref([]);

// Formatted transactions for display
const realTransactions = computed(() => {
  return transactions.value.slice(0, 5); // Show only last 5 transactions
});

// WebAuthn client
let client = null;
// XRPL client
let xrplClient = null;

onMounted(async () => {
  // Check if user has a wallet
  try {
    const userDataStr = localStorage.getItem('webauthn_user');
    if (!userDataStr) {
      navigateTo('/');
      return;
    }

    userWallet.value = JSON.parse(userDataStr);
    console.log('User data loaded:', userWallet.value);
    
    try {
      // Dynamically import WebAuthn library
      const webauthn = await import('@passwordless-id/webauthn');
      client = webauthn.client;
      console.log('WebAuthn library loaded successfully');
    } catch (webauthnError) {
      console.error('Error loading WebAuthn:', webauthnError);
      errorMessage.value = "WebAuthn loading error: " + webauthnError.message;
      step.value = 'error';
      return;
    }
    
    try {
      // Initialize XRPL client correctly
      xrplClient = new xrpl.Client('wss://s.altnet.rippletest.net:51233');
      await xrplClient.connect();
      console.log('XRPL client initialized and connected successfully');
    } catch (xrplError) {
      console.error('Error initializing XRPL client:', xrplError);
      errorMessage.value = "XRPL connection error: " + xrplError.message;
      step.value = 'error';
      return;
    }
    
    // If we have user data, proceed to wallet step
    if (userWallet.value && userWallet.value.xrplAddress) {
      step.value = 'wallet';
      
      // Initialize with empty values, not fake data
      walletBalance.value = '...';
      transactions.value = [];
      
      // Get real data immediately
      await refreshBalance();
    }
  } catch (error) {
    console.error('Error loading profile data:', error);
    errorMessage.value = 'Unable to load user data. Please reconnect.';
    step.value = 'error';
  }
});

// Function to format dates
function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Function to authenticate
async function authenticate() {
  if (!client) {
    errorMessage.value = 'WebAuthn client not initialized';
    step.value = 'error';
    return;
  }
  
  loading.value = true;
  loadingMessage.value = 'Authentication in progress...';
  
  try {
    // 1. Request a challenge from the server
    const response = await fetch('/api/webauthn/challenge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        username: userWallet.value.username,
        type: 'authentication'
      }),
    });
    
    if (!response.ok) {
      throw new Error('Error requesting the challenge');
    }
    
    const { challenge } = await response.json();
    
    // 2. Trigger authentication in the browser (biometric)
    const authentication = await client.authenticate({
      challenge,
    });
    
    // 3. Send data to server for verification
    const verificationResponse = await fetch('/api/webauthn/authenticate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: userWallet.value.username,
        authentication,
      }),
    });
    
    if (!verificationResponse.ok) {
      const errorData = await verificationResponse.json();
      throw new Error(errorData.message || 'Verification error');
    }
    
    // 4. Authentication successful, display wallet
    loadingMessage.value = 'Retrieving wallet data...';
    
    // Get wallet balance
    await refreshBalance();
    
    // Move to wallet step
    step.value = 'wallet';
    
  } catch (error) {
    console.error('Authentication error:', error);
    errorMessage.value = error.message || 'An error occurred during authentication';
    step.value = 'error';
  } finally {
    loading.value = false;
  }
}

// Function to refresh balance
async function refreshBalance() {
  loading.value = true;
  loadingMessage.value = 'Updating wallet...';
  
  try {
    // Check if XRPL client is initialized and connected
    if (!xrplClient || !xrplClient.isConnected()) {
      try {
        if (xrplClient) {
          await xrplClient.disconnect();
        }
        
        xrplClient = new xrpl.Client('wss://s.altnet.rippletest.net:51233');
        await xrplClient.connect();
        console.log('XRPL client reconnected successfully');
      } catch (error) {
        console.error('Error reconnecting to XRPL client:', error);
        throw new Error('Unable to connect to XRPL network');
      }
    }
    
    if (userWallet.value?.xrplAddress) {
      // Get real balance from XRPL
      const accountInfoRequest = {
        command: 'account_info',
        account: userWallet.value.xrplAddress,
        ledger_index: 'validated'
      };
      
      const accountInfo = await xrplClient.request(accountInfoRequest);
      console.log('XRPL response:', accountInfo);
      
      if (accountInfo.result && accountInfo.result.account_data) {
        walletBalance.value = (Number(accountInfo.result.account_data.Balance) / 1000000).toFixed(2);
      } else {
        throw new Error('Invalid XRPL response format');
      }
      
      // Get transactions
      const txRequest = {
        command: 'account_tx',
        account: userWallet.value.xrplAddress,
        limit: 10
      };
      
      const txResponse = await xrplClient.request(txRequest);
      console.log('XRPL transactions:', txResponse);
      
      if (txResponse.result && txResponse.result.transactions) {
        transactions.value = txResponse.result.transactions.map(tx => ({
          TransactionType: tx.tx.TransactionType,
          Amount: tx.tx.Amount,
          date: new Date(tx.tx.date * 1000),
          hash: tx.tx.hash
        }));
      } else {
        // If no transactions found, set an empty array
        transactions.value = [];
      }
    }
    
    // Update last refresh date
    lastRefreshed.value = new Date().toLocaleString('en-US', {
      day: 'numeric',
      month: 'long',
      hour: 'numeric',
      minute: 'numeric'
    });
    
  } catch (error) {
    console.error('Error retrieving data:', error);
    errorMessage.value = "Unable to retrieve wallet data: " + error.message;
    // Don't set fake data, show error
  } finally {
    loading.value = false;
  }
}

// Function to copy to clipboard
async function copyToClipboard(text) {
  if (!text) return;
  
  try {
    await navigator.clipboard.writeText(text);
    copiedAddress.value = true;
    setTimeout(() => {
      copiedAddress.value = false;
    }, 2000);
  } catch (err) {
    console.error('Error copying to clipboard:', err);
  }
}

</script>

<style scoped>
.wallet-container {
  max-width: 900px;
  margin: 0 auto;
  padding: var(--space-4);
  animation: fadeIn var(--transition-slow);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Loading animation améliorée */
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

/* Auth Card */
.auth-card {
  background: var(--dark-card);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-lg);
  padding: var(--space-8);
  transition: all var(--transition);
  border: 1px solid var(--dark-border);
  position: relative;
  overflow: hidden;
  backdrop-filter: var(--backdrop-blur);
  -webkit-backdrop-filter: var(--backdrop-blur);
}

/* Effet de verre */
.auth-card::before, .dashboard-card::before, .error-card::before {
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

/* Barre supérieure de couleur */
.auth-card::after, .dashboard-card::after, .error-card::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 3px;
  background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
  z-index: 1;
}

.auth-card:hover {
  transform: translateY(-5px);
  box-shadow: var(--shadow-xl), var(--glow-primary);
  border-color: rgba(99, 102, 241, 0.3);
}

.wallet-dashboard {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.wallet-header {
  position: relative;
  margin-bottom: var(--space-2);
  text-align: center;
}

.wallet-title {
  font-size: 2rem;
  font-weight: 800;
  margin-bottom: var(--space-4);
  background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  position: relative;
  z-index: 2;
}

/* Élements de décoration */
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

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: var(--space-6);
  margin-bottom: var(--space-6);
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

.dashboard-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-xl), var(--glow-primary);
  border-color: rgba(99, 102, 241, 0.3);
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

.card-footer {
  margin-top: var(--space-4);
  font-size: 0.8rem;
  color: var(--gray-400);
}

.last-updated {
  display: block;
  text-align: right;
  font-style: italic;
}

/* Balance Card */
.balance-card {
  background: linear-gradient(145deg, var(--dark-card), rgba(31, 41, 55, 0.8));
}

.balance-amount {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin: var(--space-4) 0;
}

.balance-value {
  font-size: 3rem;
  font-weight: 700;
  background: linear-gradient(90deg, var(--primary-light) 0%, var(--accent-light) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  position: relative;
  z-index: 2;
  line-height: 1;
}

.balance-currency {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--gray-400);
}

.refresh-button {
  background: rgba(99, 102, 241, 0.1);
  color: var(--primary-light);
  border: none;
  width: 36px;
  height: 36px;
  border-radius: var(--border-radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.refresh-button:hover {
  background: rgba(99, 102, 241, 0.2);
  transform: rotate(45deg);
  color: var(--accent-light);
}

.refresh-icon {
  font-size: 1.1rem;
}

/* Address Card */
.address-card {
  display: flex;
  flex-direction: column;
}

.address-box {
  background: var(--dark-surface);
  padding: var(--space-4);
  border-radius: var(--border-radius);
  border: 1px solid var(--dark-border);
  transition: all var(--transition);
  position: relative;
  overflow: hidden;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-4);
  height: 100%;
}

.address-box::before {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle, rgba(99, 102, 241, 0.1) 0%, transparent 70%);
  opacity: 0;
  z-index: 0;
  transform: scale(0.5);
  transition: opacity var(--transition), transform var(--transition);
}

.address-box:hover::before {
  opacity: 1;
  transform: scale(1);
}

.address-box p {
  font-size: 0.875rem;
  color: var(--gray-300);
  word-break: break-all;
  position: relative;
  z-index: 1;
  margin: 0;
}

.copy-button {
  background: rgba(99, 102, 241, 0.1);
  color: var(--primary-light);
  border: none;
  width: 36px;
  height: 36px;
  min-width: 36px;
  border-radius: var(--border-radius-full);
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);
  position: relative;
  z-index: 1;
}

.copy-button:hover {
  background: rgba(99, 102, 241, 0.2);
  color: var(--accent-light);
  transform: translateY(-2px);
  box-shadow: var(--glow-primary);
}

.copied-icon {
  color: var(--success);
}

/* Transactions Section */
.transactions-section {
  margin-bottom: var(--space-6);
}

.transactions-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.transaction-item {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--border-radius);
  background: rgba(99, 102, 241, 0.03);
  border: 1px solid rgba(99, 102, 241, 0.1);
  transition: all var(--transition);
}

.transaction-item:hover {
  transform: translateX(5px);
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.2);
}

.transaction-icon {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: var(--border-radius-full);
  background: rgba(99, 102, 241, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.tx-icon {
  font-size: 1.2rem;
}

.tx-icon.payment {
  font-size: 1.5rem;
}

.transaction-details {
  flex: 1;
}

.transaction-type {
  font-weight: 600;
  color: var(--gray-200);
  font-size: 0.95rem;
}

.transaction-date {
  color: var(--gray-400);
  font-size: 0.8rem;
}

.transaction-amount {
  font-weight: 600;
  color: var(--gray-300);
  font-size: 1rem;
}

.amount-positive {
  color: var(--success);
}

.no-transactions {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-8) 0;
  gap: var(--space-4);
  color: var(--gray-400);
}

.empty-state-icon {
  font-size: 3rem;
  margin-bottom: var(--space-2);
  opacity: 0.7;
}

.small-button {
  padding: var(--space-2) var(--space-4);
  font-size: 0.85rem;
}

/* Faucet Card */
.faucet-card {
  margin-bottom: var(--space-6);
}

.faucet-info {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4);
  background: linear-gradient(to right, rgba(99, 102, 241, 0.04), rgba(139, 92, 246, 0.04));
  border-radius: var(--border-radius);
  position: relative;
}

.faucet-icon {
  font-size: 2.5rem;
  animation: dropAnimation 2s infinite ease-in-out;
  filter: drop-shadow(0 0 8px rgba(99, 102, 241, 0.5));
}

.faucet-details p {
  margin-bottom: var(--space-2);
  color: var(--gray-300);
}

.faucet-note {
  font-size: 0.85rem;
  color: var(--gray-400);
  font-style: italic;
}

@keyframes dropAnimation {
  0% { transform: translateY(0); }
  50% { transform: translateY(5px); }
  100% { transform: translateY(0); }
}

/* Wallet Actions */
.wallet-actions {
  display: flex;
  gap: var(--space-4);
  justify-content: center;
  flex-wrap: wrap;
}

.primary-button, .secondary-button {
  padding: var(--space-3) var(--space-6);
  border-radius: var(--border-radius);
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  position: relative;
  overflow: hidden;
}

.button-shine {
  position: absolute;
  top: 0;
  left: -150%;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.2),
    transparent
  );
  transition: left 0.5s ease;
  z-index: 0;
}

.primary-button:hover .button-shine, 
.secondary-button:hover .button-shine {
  left: 150%;
}

.primary-button {
  background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
  color: white;
  border: none;
}

.primary-button:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-md), var(--glow-primary);
}

.secondary-button {
  background: transparent;
  color: var(--primary-light);
  border: 1px solid var(--primary);
}

.secondary-button:hover {
  background: rgba(99, 102, 241, 0.1);
  color: var(--accent-light);
  transform: translateY(-3px);
}

.button-icon {
  font-size: 1.1rem;
  transition: transform var(--transition);
}

.primary-button:hover .button-icon,
.secondary-button:hover .button-icon {
  transform: translateY(-2px);
}

/* Error Card */
.error-card {
  text-align: center;
  padding: var(--space-8);
  background: rgba(239, 68, 68, 0.05);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-lg);
}

.error-card::after {
  background: linear-gradient(90deg, var(--danger) 0%, var(--warning) 100%);
}

.error-icon {
  font-size: 3rem;
  margin-bottom: var(--space-4);
  position: relative;
  display: inline-block;
}

.error-icon::before {
  content: '';
  position: absolute;
  width: 80px;
  height: 80px;
  background: rgba(239, 68, 68, 0.1);
  border-radius: 50%;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: -1;
  animation: pulse 3s infinite alternate ease-in-out;
}

.error-card h2 {
  color: var(--danger);
  font-size: 1.5rem;
  margin-bottom: var(--space-4);
}

.error-card p {
  color: var(--gray-300);
  margin-bottom: var(--space-6);
}

/* Animation */
@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 768px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
  
  .wallet-actions {
    flex-direction: column;
  }
  
  .balance-value {
    font-size: 2.5rem;
  }
  
  .balance-currency {
    font-size: 1.2rem;
  }
  
  .faucet-info {
    flex-direction: column;
    text-align: center;
  }
}

@media (max-width: 640px) {
  .wallet-container {
    padding: var(--space-2);
  }
  
  .dashboard-card {
    padding: var(--space-4);
  }
  
  .transaction-item {
    padding: var(--space-2);
    gap: var(--space-2);
  }
  
  .transaction-icon {
    width: 32px;
    height: 32px;
    min-width: 32px;
  }
  
  .transaction-amount {
    font-size: 0.9rem;
  }
}
</style> 