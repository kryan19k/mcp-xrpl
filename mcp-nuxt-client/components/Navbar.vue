<template>
  <nav class="navbar">
    <div class="container navbar-container">
      <NuxtLink to="/" class="navbar-logo">
        <span class="logo-icon">🤖</span>
        <span class="logo-text">AI XRPL Bank</span>
      </NuxtLink>
      
      <div class="navbar-links">
        <NuxtLink to="/" class="navbar-link">Home</NuxtLink>
        <template v-if="isLoggedIn">
          <NuxtLink to="/wallet" class="navbar-link">
            <span class="link-icon">💼</span>
            My Banking
          </NuxtLink>
          <button @click="logout" class="navbar-link logout-button">
            <span class="link-icon">🚪</span>
            Logout
          </button>
        </template>
        <template v-else>
          <NuxtLink to="/register" class="navbar-link">
            <span class="link-icon">✨</span>
            Open Account
          </NuxtLink>
          <NuxtLink to="/login" class="navbar-link">
            <span class="link-icon">🔑</span>
            Login
          </NuxtLink>
        </template>
      </div>
    </div>
  </nav>
</template>

<script setup>
import { ref, onMounted, watch, onBeforeUnmount } from 'vue';

const isLoggedIn = ref(false);

// Check if the user is logged in
function checkLoginStatus() {
  try {
    // Force a clear verification of localStorage
    const userData = localStorage.getItem('webauthn_user');
    console.log('Navbar - Login status:', !!userData, userData ? '(logged in)' : '(logged out)');
    isLoggedIn.value = !!userData;
    
    // Broadcast login status to synchronize all components
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('login-status-change', { 
        detail: { isLoggedIn: isLoggedIn.value } 
      }));
    }
  } catch (error) {
    console.error('Error checking login status:', error);
    isLoggedIn.value = false;
  }
}

// Check login status on load and on each route change
onMounted(() => {
  checkLoginStatus();
  // Check status every second to ensure synchronization
  const interval = setInterval(checkLoginStatus, 1000);
  
  // Clean up interval when component is destroyed
  onBeforeUnmount(() => {
    clearInterval(interval);
  });
});

// Logout function
function logout() {
  localStorage.removeItem('webauthn_user');
  isLoggedIn.value = false;
  navigateTo('/');
}

// Watch for route changes to update login status
watch(() => window.location.href, () => {
  checkLoginStatus();
});
</script>

<style scoped>
.navbar {
  background: rgba(15, 23, 42, 0.8);
  color: var(--gray-300);
  padding: var(--space-4) 0;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
  position: sticky;
  top: 0;
  z-index: 100;
  margin-bottom: var(--space-8);
  border-bottom: 1px solid rgba(51, 65, 85, 0.6);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  transition: background-color var(--transition), box-shadow var(--transition);
}

.navbar:hover {
  background: rgba(30, 41, 59, 0.9);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2), var(--glow-primary);
}

.navbar-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 var(--space-4);
}

.navbar-logo {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--gray-100);
  display: flex;
  align-items: center;
  letter-spacing: -0.5px;
  position: relative;
  transition: transform var(--transition);
}

.navbar-logo:hover {
  transform: translateY(-2px);
}

.navbar-logo::after {
  content: '';
  position: absolute;
  bottom: -4px;
  left: 0;
  width: 100%;
  height: 2px;
  background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform var(--transition);
  opacity: 0.8;
}

.navbar-logo:hover::after {
  transform: scaleX(1);
}

.logo-icon {
  margin-right: var(--space-2);
  font-size: 1.25rem;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.logo-icon::before {
  content: '';
  position: absolute;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--border-radius-full);
  background: rgba(99, 102, 241, 0.15);
  z-index: -1;
  transition: transform var(--transition), opacity var(--transition);
}

.navbar-logo:hover .logo-icon::before {
  transform: scale(1.2);
  opacity: 0.3;
  box-shadow: var(--glow-primary);
}

.logo-text {
  background: linear-gradient(135deg, var(--primary-light) 0%, var(--accent-light) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-weight: 800;
  letter-spacing: -0.5px;
  transition: transform var(--transition), opacity var(--transition);
}

.navbar-logo:hover .logo-text {
  opacity: 0.9;
}

.navbar-links {
  display: flex;
  gap: var(--space-6);
  align-items: center;
}

.navbar-link {
  color: var(--gray-400);
  font-size: 0.9rem;
  font-weight: 500;
  transition: all var(--transition);
  display: flex;
  align-items: center;
  position: relative;
  padding: var(--space-2);
  letter-spacing: 0.01em;
  text-transform: uppercase;
  font-size: 0.85rem;
}

.navbar-link::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  width: 100%;
  height: 2px;
  background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
  transform: scaleX(0);
  transform-origin: right;
  transition: transform var(--transition);
  opacity: 0.8;
}

.navbar-link:hover {
  color: var(--gray-100);
  text-shadow: 0 0 8px rgba(99, 102, 241, 0.3);
}

.navbar-link:hover::after {
  transform: scaleX(1);
  transform-origin: left;
}

.link-icon {
  margin-right: var(--space-1);
  font-size: 1rem;
  opacity: 0.9;
  transition: transform var(--transition);
}

.navbar-link:hover .link-icon {
  transform: translateY(-2px);
}

.logout-button {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--gray-400);
  font-size: 0.85rem;
  font-weight: 500;
  display: flex;
  align-items: center;
  padding: var(--space-2);
  text-transform: uppercase;
  letter-spacing: 0.01em;
  position: relative;
  transition: color var(--transition);
}

.logout-button::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  width: 100%;
  height: 2px;
  background: linear-gradient(90deg, var(--primary) 0%, var(--danger) 100%);
  transform: scaleX(0);
  transform-origin: right;
  transition: transform var(--transition);
}

.logout-button:hover {
  color: var(--danger);
  text-shadow: 0 0 8px rgba(239, 68, 68, 0.3);
}

.logout-button:hover::after {
  transform: scaleX(1);
  transform-origin: left;
}

.logout-button:hover .link-icon {
  transform: translateX(2px);
}

/* Active link styles */
.router-link-active {
  color: var(--primary-light);
  font-weight: 600;
}

.router-link-active::after {
  transform: scaleX(1);
  opacity: 1;
}

.router-link-active .link-icon {
  color: var(--primary-light);
}

@media (max-width: 640px) {
  .navbar-container {
    flex-direction: column;
    gap: var(--space-4);
  }
  
  .navbar-links {
    width: 100%;
    justify-content: center;
    gap: var(--space-4);
  }
  
  .navbar-link {
    padding: var(--space-1) var(--space-2);
    font-size: 0.8rem;
  }
  
  .link-icon {
    margin-right: 0;
  }
}
</style> 