<template>
  <div class="auth-container">
    <div class="auth-card">
      <!-- Décoration d'arrière-plan -->
      <div class="backdrop-decoration">
        <div class="glow-circle"></div>
        <div class="floating-shape shape-1"></div>
        <div class="floating-shape shape-2"></div>
        <div class="floating-shape shape-3"></div>
      </div>
      
      <!-- Titre et logo -->
      <div class="auth-header">
        <div class="logo-container">
          <div class="logo-icon">🤖</div>
        </div>
        <h1 class="auth-title">Open Banking Account</h1>
        <div class="subtitle-line"></div>
      </div>
      
      <!-- Registration tabs -->
      <div v-if="step === 'initial'" class="auth-tabs">
        <button 
          @click="registerMethod = 'abstraction'" 
          class="tab-button" 
          :class="{ 'active': registerMethod === 'abstraction' }"
        >
          <span class="tab-icon">🔐</span>
          <span>Account Abstraction</span>
        </button>
        <button 
          @click="registerMethod = 'seed'" 
          class="tab-button" 
          :class="{ 'active': registerMethod === 'seed' }"
        >
          <span class="tab-icon">🔑</span>
          <span>Use Existing Seed</span>
        </button>
      </div>
      
      <!-- Step 1: Registration form with abstraction -->
      <div v-if="step === 'initial' && registerMethod === 'abstraction'" class="auth-form">
        <div class="form-group">
          <label for="username" class="form-label">Choose Username</label>
          <div class="input-wrapper">
            <span class="input-icon">👤</span>
            <input
              type="text"
              id="username"
              v-model="username"
              class="form-input"
              placeholder="Enter a unique username"
            />
            <span class="input-focus-effect"></span>
          </div>
        </div>
        
        <button
          @click="startRegistration"
          class="auth-button"
          :disabled="!username || loading"
        >
          <span class="button-content">
            <span v-if="loading" class="loading-indicator"></span>
            <span v-else class="button-icon">✨</span>
            <span class="button-text">{{ loading ? 'Creating your account...' : 'Create AI Banking Account' }}</span>
          </span>
          <span class="button-shine"></span>
        </button>
        
        <div class="auth-links">
          <p>
            Already have an account? 
            <NuxtLink to="/login" class="auth-link">Login</NuxtLink>
          </p>
        </div>
      </div>
      
      <!-- Step 1: Registration form with seed -->
      <div v-if="step === 'initial' && registerMethod === 'seed'" class="auth-form">
        <div class="form-group">
          <label for="username_seed" class="form-label">Choose Username</label>
          <div class="input-wrapper">
            <span class="input-icon">👤</span>
            <input
              type="text"
              id="username_seed"
              v-model="username"
              class="form-input"
              placeholder="Enter a unique username"
            />
            <span class="input-focus-effect"></span>
          </div>
        </div>
        
        <div class="form-group">
          <label for="existing_seed" class="form-label">XRPL Private Key (Seed)</label>
          <div class="input-wrapper">
            <span class="input-icon">🔐</span>
            <input
              :type="showExistingSeed ? 'text' : 'password'"
              id="existing_seed"
              v-model="existingSeed"
              class="form-input"
              placeholder="Enter your XRPL private key"
            />
            <button 
              @click="toggleExistingSeedVisibility" 
              class="input-action-button"
            >
              <span v-if="showExistingSeed" class="eye-icon">👁️</span>
              <span v-else class="eye-icon">👁️‍🗨️</span>
            </button>
            <span class="input-focus-effect"></span>
          </div>
        </div>
        
        <button
          @click="registerWithSeed"
          class="auth-button"
          :disabled="!username || !existingSeed || loading"
        >
          <span class="button-content">
            <span v-if="loading" class="loading-indicator"></span>
            <span v-else class="button-icon">💼</span>
            <span class="button-text">{{ loading ? 'Registering account...' : 'Register with Existing Wallet' }}</span>
          </span>
          <span class="button-shine"></span>
        </button>
        
        <div class="seed-warning">
          <div class="warning-icon">⚠️</div>
          <p>Never share your private key. This method allows you to register an existing XRPL wallet with our app.</p>
        </div>
        
        <div class="auth-links">
          <p>
            Already have an account? 
            <NuxtLink to="/login" class="auth-link">Login</NuxtLink>
          </p>
        </div>
      </div>
      
      <!-- Step 2: Wallet creation confirmation -->
      <div v-if="step === 'success'" class="success-container">
        <div class="success-header">
          <div class="success-icon">
            <div class="icon-bg"></div>
            <span>✅</span>
          </div>
          <h2 class="success-title">Account Created!</h2>
          <p class="success-message">Your AI-powered XRPL Banking account has been successfully activated.</p>
        </div>

        <div class="alert-box">
          <div class="alert-icon">⚠️</div>
          <div class="alert-content">
            <h3 class="alert-title">Important Security Note</h3>
            <p class="alert-message">Store your private key in a secure location. It will never be displayed again and is essential for account recovery.</p>
          </div>
        </div>

        <div class="wallet-info">
          <div class="wallet-field">
            <label class="wallet-label">XRPL Account Address</label>
            <div class="wallet-value-container">
              <input 
                type="text" 
                readonly 
                class="wallet-value" 
                :value="walletData.xrplAddress"
              />
              <button 
                @click="copyToClipboard(walletData.xrplAddress)" 
                class="copy-button"
                :class="{ 'copied': copiedAddress }"
              >
                <span v-if="!copiedAddress" class="copy-icon">📋</span>
                <span v-else class="copied-icon">✓</span>
              </button>
            </div>
          </div>

          <div class="wallet-field">
            <label class="wallet-label">XRPL Private Key</label>
            <div class="wallet-value-container">
              <input 
                :type="showSeed ? 'text' : 'password'" 
                readonly 
                class="wallet-value" 
                :value="walletData.xrplSeed"
              />
              <div class="wallet-actions">
                <button 
                  @click="toggleSeedVisibility" 
                  class="action-button"
                >
                  <span v-if="showSeed" class="eye-icon">👁️</span>
                  <span v-else class="eye-icon">👁️‍🗨️</span>
                </button>
                <button 
                  @click="copyToClipboard(walletData.xrplSeed)" 
                  class="action-button"
                  :class="{ 'copied': copiedSeed }"
                >
                  <span v-if="!copiedSeed" class="copy-icon">📋</span>
                  <span v-else class="copied-icon">✓</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="confirmation-box">
          <label class="checkbox-container">
            <input 
              type="checkbox" 
              v-model="hasBackedUp"
              class="checkbox-input" 
            />
            <span class="checkbox-custom"></span>
            <span class="checkbox-label">I have securely stored my private key</span>
          </label>
          
          <button 
            @click="connectToWallet" 
            class="auth-button"
            :disabled="!hasBackedUp"
          >
            <span class="button-content">
              <span class="button-icon">🏦</span>
              <span class="button-text">Access My AI Banking Dashboard</span>
            </span>
            <span class="button-shine"></span>
          </button>
        </div>
      </div>
      
      <!-- Error step -->
      <div v-if="step === 'error'" class="auth-error">
        <div class="error-icon">❌</div>
        <h2 class="error-title">Account Creation Failed</h2>
        <p class="error-message">{{ errorMessage }}</p>
        <button @click="step = 'initial'" class="retry-button">
          Try Again
          <span class="button-shine"></span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import * as xrpl from 'xrpl';

let client = null;

// Form state
const username = ref('');
const loading = ref(false);
const step = ref('initial');
const errorMessage = ref('');
const showSeed = ref(false);
const hasBackedUp = ref(false);
const copiedAddress = ref(false);
const copiedSeed = ref(false);
const registerMethod = ref('abstraction');
const existingSeed = ref('');
const showExistingSeed = ref(false);
const walletData = ref({
  xrplAddress: '',
  xrplSeed: '',
  username: ''
});

onMounted(async () => {
  // Check if user is already registered
  const userData = localStorage.getItem('webauthn_user');
  if (userData) {
    navigateTo('/');
    return;
  }

  // Dynamically import WebAuthn library
  try {
    const webauthn = await import('@passwordless-id/webauthn');
    client = webauthn.client;
  } catch (error) {
    console.error('Error loading WebAuthn library:', error);
    step.value = 'error';
    errorMessage.value = 'Unable to load WebAuthn library';
  }
});

// Function to toggle existing seed visibility
function toggleExistingSeedVisibility() {
  showExistingSeed.value = !showExistingSeed.value;
}

// Register with existing seed
async function registerWithSeed() {
  if (!username.value || !existingSeed.value) return;
  
  loading.value = true;
  
  try {
    // Validate and connect with the provided seed
    let wallet;
    try {
      wallet = xrpl.Wallet.fromSeed(existingSeed.value.trim());
    } catch (error) {
      throw new Error('Invalid seed format. Please check your private key.');
    }
    
    // Try to connect to XRPL to verify the account exists
    const client = new xrpl.Client('wss://s.altnet.rippletest.net:51233');
    await client.connect();
    
    try {
      // Get account info to verify it exists
      const accountInfo = await client.request({
        command: 'account_info',
        account: wallet.address,
        ledger_index: 'validated'
      });
      
      if (!accountInfo.result || !accountInfo.result.account_data) {
        throw new Error('Account not found on the XRPL network.');
      }
      
      // Set wallet data for display
      walletData.value = {
        username: username.value,
        xrplAddress: wallet.address,
        xrplSeed: existingSeed.value
      };
      
      // Account exists, create a user object
      const userData = {
        username: username.value,
        credentials: [],  // Empty because we're using seed login
        xrplAddress: wallet.address,
        xrplSeed: existingSeed.value,
        registeredAt: Date.now(),
        loginMethod: 'seed'
      };
      
      // Store in localStorage
      localStorage.setItem('webauthn_user', JSON.stringify(userData));
      
      // Registration successful, show wallet information
      step.value = 'success';
      
    } catch (error) {
      console.error('XRPL account verification error:', error);
      throw new Error('Unable to verify account on XRPL. The account may not exist.');
    } finally {
      await client.disconnect();
    }
    
  } catch (error) {
    console.error('Seed registration error:', error);
    step.value = 'error';
    errorMessage.value = error.message || 'An error occurred during registration with seed';
  } finally {
    loading.value = false;
  }
}

// Start registration process with account abstraction
async function startRegistration() {
  if (!username.value) return;
  
  loading.value = true;
  
  try {
    // 1. Request a challenge from the server
    const response = await fetch('/api/webauthn/challenge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: username.value }),
    });
    
    if (!response.ok) {
      throw new Error('Error requesting the challenge');
    }
    
    const { challenge } = await response.json();
    
    // 2. Trigger registration in the browser
    const registration = await client.register({
      user: username.value,
      challenge,
    });
    
    // 3. Send data to server for verification
    const verificationResponse = await fetch('/api/webauthn/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: username.value,
        registration,
        challenge,
      }),
    });
    
    if (!verificationResponse.ok) {
      const errorData = await verificationResponse.json();
      throw new Error(errorData.message || 'Verification error');
    }
    
    // Get wallet data
    const userData = await verificationResponse.json();
    console.log('Received user data:', userData);  // Debug: Log to see full response data
    
    // Store wallet information
    walletData.value = {
      username: userData.user.username,
      xrplAddress: userData.user.xrplAddress,
      xrplSeed: userData.xrplSeed || 'Seed not provided'  // Ensure a fallback if seed is missing
    };
    
    console.log('Wallet data set:', walletData.value);  // Debug: Verify wallet data is correct
    
    // Store in localStorage
    localStorage.setItem('webauthn_user', JSON.stringify({
      username: userData.user.username,
      credentials: userData.user.credentials,
      xrplAddress: userData.user.xrplAddress,
      xrplSeed: userData.xrplSeed,
      registeredAt: userData.user.registeredAt,
      loginMethod: 'abstraction'
    }));
    
    // Save seed to .env file via API
    try {
      const saveSeedResponse = await fetch('/api/saveSeed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: userData.user.username,
          xrplSeed: userData.xrplSeed
        }),
      });
      
      if (saveSeedResponse.ok) {
        console.log('Seed successfully saved to .env file');
      } else {
        console.warn('Failed to save seed to .env file, but registration was successful');
      }
    } catch (seedError) {
      console.error('Error saving seed to .env:', seedError);
      // Continue with registration process even if saving to .env fails
    }
    
    // Registration successful, show wallet information
    step.value = 'success';
    
  } catch (error) {
    console.error('Registration error:', error);
    step.value = 'error';
    errorMessage.value = error.message || 'An error occurred during registration';
  } finally {
    loading.value = false;
  }
}

// Function to copy to clipboard
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    
    if (text === walletData.value.xrplAddress) {
      copiedAddress.value = true;
      setTimeout(() => {
        copiedAddress.value = false;
      }, 2000);
    } else if (text === walletData.value.xrplSeed) {
      copiedSeed.value = true;
      setTimeout(() => {
        copiedSeed.value = false;
      }, 2000);
    }
  } catch (err) {
    console.error('Error copying to clipboard:', err);
  }
}

// Function to toggle private key visibility
function toggleSeedVisibility() {
  showSeed.value = !showSeed.value;
}

// Function to access wallet
function connectToWallet() {
  navigateTo('/wallet');
}
</script>

<style scoped>
.auth-container {
  max-width: 600px;
  margin: 0 auto;
  padding: var(--space-8) var(--space-4);
  position: relative;
}

.auth-card {
  background: rgba(17, 24, 39, 0.7);
  border-radius: var(--border-radius-xl);
  box-shadow: var(--shadow-xl), 0 0 30px rgba(99, 102, 241, 0.15);
  padding: var(--space-8);
  transition: transform var(--transition), box-shadow var(--transition);
  border: 1px solid rgba(99, 102, 241, 0.2);
  position: relative;
  overflow: hidden;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  z-index: 1;
}

.auth-card:hover {
  transform: translateY(-5px);
  box-shadow: var(--shadow-xl), 0 10px 40px rgba(99, 102, 241, 0.25);
}

/* Éléments décoratifs d'arrière-plan */
.backdrop-decoration {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  z-index: -1;
}

.glow-circle {
  position: absolute;
  top: 20%;
  left: 50%;
  transform: translateX(-50%);
  width: 150px;
  height: 150px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, transparent 70%);
  animation: pulse 8s infinite alternate ease-in-out;
}

.floating-shape {
  position: absolute;
  border-radius: 30% 70% 70% 30% / 30% 30% 70% 70%;
  opacity: 0.1;
}

.shape-1 {
  top: 10%;
  right: 10%;
  width: 100px;
  height: 100px;
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
  animation: float 10s infinite alternate ease-in-out;
}

.shape-2 {
  bottom: 10%;
  left: 10%;
  width: 80px;
  height: 80px;
  background: linear-gradient(135deg, var(--accent) 0%, var(--primary) 100%);
  animation: float 12s infinite alternate-reverse ease-in-out;
}

.shape-3 {
  top: 40%;
  left: 20%;
  width: 60px;
  height: 60px;
  background: linear-gradient(135deg, var(--primary-light) 0%, var(--accent) 100%);
  animation: float 9s infinite alternate ease-in-out;
}

@keyframes float {
  0% {
    transform: translate(0px, 0px) rotate(0deg);
  }
  50% {
    transform: translate(15px, -15px) rotate(10deg);
  }
  100% {
    transform: translate(0px, 0px) rotate(0deg);
  }
}

@keyframes pulse {
  0% {
    opacity: 0.3;
    transform: translateX(-50%) scale(0.8);
  }
  50% {
    opacity: 0.5;
    transform: translateX(-50%) scale(1.1);
  }
  100% {
    opacity: 0.3;
    transform: translateX(-50%) scale(0.8);
  }
}

/* En-tête de l'authentification */
.auth-header {
  text-align: center;
  margin-bottom: var(--space-8);
  position: relative;
}

.logo-container {
  display: flex;
  justify-content: center;
  margin-bottom: var(--space-4);
}

.logo-icon {
  font-size: 2.5rem;
  width: 70px;
  height: 70px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--border-radius-full);
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(139, 92, 246, 0.15) 100%);
  position: relative;
  margin-bottom: var(--space-2);
  animation: glow 3s infinite alternate ease-in-out;
}

@keyframes glow {
  0% {
    box-shadow: 0 0 10px rgba(99, 102, 241, 0.3);
  }
  100% {
    box-shadow: 0 0 20px rgba(99, 102, 241, 0.5);
  }
}

.auth-title {
  font-size: 2rem;
  font-weight: 800;
  margin-bottom: var(--space-3);
  background: linear-gradient(135deg, var(--primary-light) 0%, var(--accent-light) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  letter-spacing: -0.03em;
}

.subtitle-line {
  width: 60px;
  height: 3px;
  background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
  margin: 0 auto var(--space-6);
  border-radius: var(--border-radius-full);
}

/* Formulaire */
.auth-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  position: relative;
}

.form-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--gray-300);
  margin-left: var(--space-1);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.input-wrapper {
  position: relative;
  transition: all var(--transition);
}

.input-icon {
  position: absolute;
  left: var(--space-4);
  top: 50%;
  transform: translateY(-50%);
  font-size: 1rem;
  color: var(--gray-400);
  transition: all var(--transition);
}

.form-input {
  padding: var(--space-4) var(--space-4) var(--space-4) var(--space-8);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: var(--border-radius);
  background-color: rgba(30, 41, 59, 0.5);
  color: var(--gray-200);
  font-size: 1rem;
  width: 100%;
  transition: all var(--transition-fast);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.form-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
  outline: none;
  background-color: rgba(30, 41, 59, 0.7);
}

.form-input:focus ~ .input-icon {
  color: var(--primary-light);
}

.input-focus-effect {
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
  transition: all var(--transition);
  transform: translateX(-50%);
  border-radius: var(--border-radius-full);
}

.form-input:focus ~ .input-focus-effect {
  width: calc(100% - 2px);
}

.auth-button {
  position: relative;
  background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
  color: white;
  border: none;
  padding: var(--space-4) var(--space-6);
  border-radius: var(--border-radius);
  font-weight: 600;
  font-size: 1rem;
  cursor: pointer;
  transition: all var(--transition);
  overflow: hidden;
  width: 100%;
  z-index: 1;
  box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3);
}

.auth-button:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4);
}

.auth-button:disabled {
  background: var(--gray-700);
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.button-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  position: relative;
  z-index: 2;
}

.button-icon {
  font-size: 1.1rem;
}

.button-shine {
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.3),
    transparent
  );
  transition: left 0.7s ease;
  z-index: 1;
}

.auth-button:hover .button-shine {
  left: 100%;
}

.loading-indicator {
  width: 1.25rem;
  height: 1.25rem;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: white;
  border-left-color: white;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.auth-links {
  text-align: center;
  font-size: 0.95rem;
  color: var(--gray-400);
}

.auth-link {
  color: var(--primary-light);
  font-weight: 600;
  transition: all var(--transition-fast);
  position: relative;
  display: inline-block;
}

.auth-link::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  width: 100%;
  height: 1px;
  background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
  transform: scaleX(0);
  transform-origin: right;
  transition: transform var(--transition);
}

.auth-link:hover {
  color: var(--accent-light);
  text-shadow: 0 0 10px rgba(99, 102, 241, 0.3);
}

.auth-link:hover::after {
  transform: scaleX(1);
  transform-origin: left;
}

/* Success styles */
.success-container {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  animation: fadeIn 0.5s;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

.success-header {
  text-align: center;
  margin-bottom: var(--space-2);
}

.success-icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 2.5rem;
  margin-bottom: var(--space-4);
}

.icon-bg {
  position: absolute;
  width: 70px;
  height: 70px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(52, 211, 153, 0.2));
  border-radius: 50%;
  animation: pulse 3s infinite alternate ease-in-out;
  z-index: -1;
}

.success-title {
  font-size: 1.8rem;
  font-weight: 700;
  margin-bottom: var(--space-2);
  background: linear-gradient(135deg, var(--primary-light), var(--success));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.success-message {
  color: var(--gray-300);
  font-size: 1.1rem;
  margin-bottom: var(--space-2);
}

.alert-box {
  background: linear-gradient(to right, rgba(99, 102, 241, 0.1), rgba(147, 197, 253, 0.05));
  border-left: 4px solid var(--primary);
  padding: var(--space-4);
  border-radius: var(--border-radius);
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  box-shadow: var(--shadow-md);
  transition: all var(--transition);
  position: relative;
}

.alert-box:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

.alert-icon {
  font-size: 1.5rem;
  animation: shake 5s infinite;
  animation-delay: 2s;
}

@keyframes shake {
  0%, 100% { transform: rotate(0); }
  2%, 6% { transform: rotate(-5deg); }
  4%, 8% { transform: rotate(5deg); }
  10% { transform: rotate(0); }
}

.alert-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: var(--space-1);
  color: var(--primary-light);
}

.alert-message {
  font-size: 0.95rem;
  color: var(--gray-300);
  line-height: 1.5;
}

.wallet-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
  animation: slideUp 0.5s ease;
  animation-fill-mode: both;
  animation-delay: 0.2s;
}

.wallet-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.wallet-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--gray-300);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.wallet-value-container {
  position: relative;
  display: flex;
  align-items: center;
}

.wallet-value {
  padding: var(--space-3) var(--space-4);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: var(--border-radius);
  font-size: 0.95rem;
  width: 100%;
  background-color: rgba(30, 41, 59, 0.5);
  color: var(--gray-200);
  font-family: monospace;
  font-weight: 500;
  transition: all var(--transition);
}

.wallet-actions {
  position: absolute;
  right: var(--space-2);
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  gap: var(--space-2);
}

.action-button, .copy-button {
  background: rgba(99, 102, 241, 0.1);
  border: none;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  color: var(--primary-light);
  cursor: pointer;
  padding: var(--space-1);
  border-radius: var(--border-radius-full);
  transition: all var(--transition-fast);
  position: relative;
  overflow: hidden;
}

.action-button:hover, .copy-button:hover {
  background-color: rgba(99, 102, 241, 0.2);
  color: var(--accent-light);
  transform: translateY(-2px);
}

.action-button.copied, .copy-button.copied {
  color: var(--success);
}

.eye-icon, .copy-icon, .copied-icon {
  font-size: 1rem;
  position: relative;
  z-index: 2;
}

.copied-icon {
  color: var(--success);
}

.confirmation-box {
  margin-top: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  animation: slideUp 0.5s ease;
  animation-fill-mode: both;
  animation-delay: 0.4s;
}

.checkbox-container {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  cursor: pointer;
  padding: var(--space-2) 0;
  position: relative;
}

.checkbox-input {
  position: absolute;
  opacity: 0;
  cursor: pointer;
  height: 0;
  width: 0;
}

.checkbox-custom {
  position: relative;
  width: 20px;
  height: 20px;
  background-color: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: var(--border-radius-sm);
  transition: all var(--transition-fast);
}

.checkbox-input:checked ~ .checkbox-custom {
  background-color: var(--primary);
  border-color: var(--primary);
}

.checkbox-custom::after {
  content: '';
  position: absolute;
  display: none;
  left: 6px;
  top: 2px;
  width: 6px;
  height: 10px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.checkbox-input:checked ~ .checkbox-custom::after {
  display: block;
}

.checkbox-label {
  font-size: 0.95rem;
  color: var(--gray-300);
  user-select: none;
}

/* Error styles */
.auth-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  animation: fadeIn 0.5s;
}

.error-icon {
  font-size: 3.5rem;
  margin-bottom: var(--space-6);
  color: var(--danger);
  opacity: 0.9;
  filter: drop-shadow(0 0 10px rgba(239, 68, 68, 0.3));
}

.error-title {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: var(--space-3);
  color: var(--danger);
}

.error-message {
  color: var(--gray-300);
  margin-bottom: var(--space-8);
  line-height: 1.6;
  font-size: 1rem;
}

.retry-button {
  background: transparent;
  border: 1px solid var(--primary);
  color: var(--primary-light);
  padding: var(--space-3) var(--space-6);
  border-radius: var(--border-radius);
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all var(--transition);
  position: relative;
  overflow: hidden;
}

.retry-button:hover {
  background: rgba(99, 102, 241, 0.1);
  color: var(--accent-light);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.15);
}

.auth-tabs {
  display: flex;
  margin-bottom: var(--space-6);
  border-radius: var(--border-radius);
  background: rgba(30, 41, 59, 0.3);
  padding: 2px;
  position: relative;
  overflow: hidden;
}

.tab-button {
  flex: 1;
  background: transparent;
  border: none;
  padding: var(--space-3);
  color: var(--gray-300);
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
  border-radius: calc(var(--border-radius) - 2px);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
}

.tab-button.active {
  background: rgba(99, 102, 241, 0.1);
  color: var(--primary-light);
  box-shadow: 0 0 10px rgba(99, 102, 241, 0.2);
}

.tab-icon {
  font-size: 1.1rem;
}

.input-action-button {
  position: absolute;
  right: var(--space-3);
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: var(--gray-400);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);
  z-index: 2;
}

.input-action-button:hover {
  color: var(--primary-light);
}

.seed-warning {
  margin-top: var(--space-4);
  background: rgba(245, 158, 11, 0.1);
  border-left: 3px solid var(--warning);
  padding: var(--space-3);
  border-radius: var(--border-radius);
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}

.warning-icon {
  font-size: 1.2rem;
  margin-top: 2px;
}

.seed-warning p {
  color: var(--gray-300);
  font-size: 0.85rem;
  margin: 0;
}

@media (max-width: 640px) {
  .auth-card {
    padding: var(--space-6);
  }
  
  .auth-title {
    font-size: 1.75rem;
  }
  
  .glow-circle, .floating-shape {
    display: none;
  }
  
  .wallet-value {
    font-size: 0.8rem;
  }
}
</style> 