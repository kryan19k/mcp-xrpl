<template>
  <div class="auth-container">
    <div class="auth-card">
      <!-- Background decoration -->
      <div class="backdrop-decoration">
        <div class="glow-circle"></div>
        <div class="floating-shape shape-1"></div>
        <div class="floating-shape shape-2"></div>
        <div class="floating-shape shape-3"></div>
      </div>
      
      <!-- Title and logo -->
      <div class="auth-header">
        <div class="logo-container">
          <div class="logo-icon">🤖</div>
        </div>
        <h1 class="auth-title">Login to AI Banking</h1>
        <div class="subtitle-line"></div>
      </div>
      
      <!-- Login form -->
      <div v-if="step === 'initial'" class="auth-form">
        <div class="form-group">
          <label for="username" class="form-label">Username</label>
          <div class="input-wrapper">
            <span class="input-icon">👤</span>
            <input
              type="text"
              id="username"
              v-model="username"
              class="form-input"
              placeholder="Enter your username"
            />
            <span class="input-focus-effect"></span>
          </div>
        </div>
        
        <button
          @click="startAuthentication"
          class="auth-button"
          :disabled="!username || loading"
        >
          <span class="button-content">
            <span v-if="loading" class="loading-indicator"></span>
            <span v-else class="button-icon">🔑</span>
            <span class="button-text">{{ loading ? 'Connecting...' : 'Access Banking' }}</span>
          </span>
          <span class="button-shine"></span>
        </button>
        
        <div class="auth-links">
          <p>
            Don't have an account yet? 
            <NuxtLink to="/register" class="auth-link">Open an Account</NuxtLink>
          </p>
        </div>
      </div>
      
      <!-- Error step -->
      <div v-if="step === 'error'" class="auth-error">
        <div class="error-icon">❌</div>
        <h2 class="error-title">Login Failed</h2>
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
let client = null;

// Form state
const username = ref('');
const loading = ref(false);
const step = ref('initial');
const errorMessage = ref('');

onMounted(async () => {
  // Check if user is already logged in
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

// Start authentication process
async function startAuthentication() {
  if (!username.value) return;
  
  loading.value = true;
  
  try {
    // 1. Request a challenge from the server
    const response = await fetch('/api/webauthn/challenge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        username: username.value,
        type: 'authentication'
      }),
    });
    
    if (!response.ok) {
      throw new Error('Error requesting the challenge');
    }
    
    const { challenge } = await response.json();
    
    // 2. Trigger authentication in the browser
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
        username: username.value,
        authentication,
      }),
    });
    
    if (!verificationResponse.ok) {
      const errorData = await verificationResponse.json();
      throw new Error(errorData.message || 'Verification error');
    }
    
    // 4. Get user data
    const userData = await verificationResponse.json();
    
    // 5. Store in localStorage (as in wallet.vue)
    localStorage.setItem('webauthn_user', JSON.stringify(userData.user));
    
    // 6. Redirect to homepage
    navigateTo('/');
    
  } catch (error) {
    console.error('Authentication error:', error);
    step.value = 'error';
    errorMessage.value = error.message || 'An error occurred during authentication';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.auth-container {
  max-width: 480px;
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
  margin-top: var(--space-4);
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

/* Error styles */
.auth-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  animation: fadeIn 0.5s;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
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
}
</style> 