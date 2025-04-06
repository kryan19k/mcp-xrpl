<template>
  <div class="home-container">
    <div class="hero-section">
      <div class="hero-content">
        <h1 class="hero-title animate-element">
          AI-Powered <span class="accent-text">XRPL</span> Banking
        </h1>
        <div class="hero-line animate-element"></div>
        <p class="hero-subtitle animate-element">
          Manage your digital assets with our AI assistant and advanced MCP technology for secure, automated XRPL transactions.
        </p>
        
        <div class="hero-actions animate-element">
          <template v-if="isLoggedIn">
            <NuxtLink to="/wallet" class="button primary-button">
              <span class="button-icon">💼</span>
              <span class="button-text">Access my wallet</span>
              <span class="button-shine"></span>
            </NuxtLink>
          </template>
          <template v-else>
            <NuxtLink to="/register" class="button primary-button">
              <span class="button-icon">✨</span>
              <span class="button-text">Create AI Wallet</span>
              <span class="button-shine"></span>
            </NuxtLink>
            <NuxtLink to="/login" class="button secondary-button">
              <span class="button-icon">🔑</span>
              <span class="button-text">Login</span>
              <span class="button-shine"></span>
            </NuxtLink>
          </template>
        </div>
      </div>
      
      <div class="hero-image animate-element">
        <div class="image-container">
          <div class="security-icon">🤖</div>
          <div class="wallet-icon">💰</div>
          <div class="xrpl-icon">💎</div>
          <div class="pulse-circle"></div>
          <div class="glow-effect"></div>
        </div>
      </div>
    </div>
    
    <div class="features-section">
      <h2 class="section-title animate-on-scroll">Why choose AI-powered XRPL Banking</h2>
      
      <div class="features-grid">
        <div class="feature-card animate-on-scroll">
          <div class="feature-icon-container">
            <div class="feature-icon">🤖</div>
            <div class="icon-backdrop"></div>
          </div>
          <h3>AI Transaction Manager</h3>
          <p>Our intelligent agent handles complex XRPL transactions with automated optimization</p>
          <div class="feature-card-shine"></div>
        </div>
        
        <div class="feature-card animate-on-scroll">
          <div class="feature-icon-container">
            <div class="feature-icon">🔄</div>
            <div class="icon-backdrop"></div>
          </div>
          <h3>MCP Implementation</h3>
          <p>Multi-signature Channel Protocol ensures secure and efficient transaction processing</p>
          <div class="feature-card-shine"></div>
        </div>
        
        <div class="feature-card animate-on-scroll">
          <div class="feature-icon-container">
            <div class="feature-icon">📊</div>
            <div class="icon-backdrop"></div>
          </div>
          <h3>Smart Banking Features</h3>
          <p>Automated payments, escrow services, and advanced XRPL token management</p>
          <div class="feature-card-shine"></div>
        </div>
      </div>
    </div>

    <div class="cta-section animate-on-scroll">
      <div class="cta-content">
        <h2>Experience next-gen banking on XRPL</h2>
        <p>Create your AI-powered wallet today and let our intelligent agent handle your transactions with precision.</p>
        <template v-if="!isLoggedIn">
          <NuxtLink to="/register" class="button primary-button wide-button">
            <span class="button-text">Start Banking with AI</span>
            <span class="button-icon">→</span>
            <span class="button-shine"></span>
          </NuxtLink>
        </template>
      </div>
      <div class="cta-backdrop"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';

const isLoggedIn = ref(false);

function checkLoginStatus() {
  try {
    const userData = localStorage.getItem('webauthn_user');
    console.log('Index - Login check:', !!userData);
    isLoggedIn.value = !!userData;
  } catch (error) {
    console.error('Error checking status:', error);
    isLoggedIn.value = false;
  }
}

onMounted(() => {
  // Force logout on startup if necessary
  if (typeof window !== 'undefined' && sessionStorage.getItem('force_logout') === 'true') {
    localStorage.removeItem('webauthn_user');
    sessionStorage.removeItem('force_logout');
  }
  
  checkLoginStatus();
  
  // Listen for login status changes from other components
  if (typeof window !== 'undefined') {
    window.addEventListener('login-status-change', (event) => {
      console.log('Index - Event received:', event.detail);
      isLoggedIn.value = event.detail.isLoggedIn;
    });
    
    // Force a check every 500ms during the first 5 seconds
    let count = 0;
    const interval = setInterval(() => {
      checkLoginStatus();
      count++;
      if (count >= 10) clearInterval(interval);
    }, 500);
    
    // Animations on scroll
    const animateOnScrollObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    }, { threshold: 0.1 });
    
    document.querySelectorAll('.animate-on-scroll').forEach((element) => {
      animateOnScrollObserver.observe(element);
    });
    
    document.querySelectorAll('.feature-card').forEach((element) => {
      animateOnScrollObserver.observe(element);
    });
  }
});

watch(isLoggedIn, (newValue) => {
  console.log('Login status updated:', newValue);
});
</script>

<style scoped>
.home-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 var(--space-4);
  overflow-x: hidden;
}

.hero-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-16) 0 var(--space-12);
  gap: var(--space-8);
  position: relative;
}

.hero-content {
  flex: 1;
  position: relative;
}

.hero-title {
  font-size: 3.5rem;
  font-weight: 900;
  margin-bottom: var(--space-6);
  line-height: 1.1;
  background: linear-gradient(135deg, var(--primary-light) 0%, var(--accent-light) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  letter-spacing: -0.03em;
  transform: translateY(30px);
  opacity: 0;
  animation: fadeInUp 0.8s forwards;
}

.hero-line {
  width: 80px;
  height: 4px;
  background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
  margin-bottom: var(--space-6);
  transform: translateX(-30px);
  opacity: 0;
  animation: fadeInRight 0.8s 0.3s forwards;
  border-radius: var(--border-radius-full);
}

.accent-text {
  color: var(--accent);
  background: none;
  -webkit-background-clip: initial;
  background-clip: initial;
  position: relative;
}

.accent-text::after {
  content: '';
  position: absolute;
  width: 100%;
  height: 10px;
  bottom: 5px;
  left: 0;
  background: linear-gradient(90deg, rgba(139, 92, 246, 0.3), rgba(99, 102, 241, 0.1));
  z-index: -1;
  border-radius: var(--border-radius-full);
}

.hero-subtitle {
  font-size: 1.25rem;
  color: var(--gray-300);
  margin-bottom: var(--space-8);
  max-width: 540px;
  line-height: 1.6;
  transform: translateY(30px);
  opacity: 0;
  animation: fadeInUp 0.8s 0.6s forwards;
}

.hero-actions {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
  transform: translateY(30px);
  opacity: 0;
  animation: fadeInUp 0.8s 0.9s forwards;
}

.button {
  display: flex;
  align-items: center;
  padding: 0.9rem 1.8rem;
  border-radius: var(--border-radius);
  font-weight: 600;
  font-size: 1rem;
  transition: all var(--transition);
  position: relative;
  overflow: hidden;
  z-index: 1;
}

.button-icon {
  margin-right: var(--space-2);
  font-size: 1.1rem;
  transition: transform var(--transition);
  z-index: 1;
}

.button-text {
  z-index: 1;
  position: relative;
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
    rgba(255, 255, 255, 0.25),
    transparent
  );
  transition: left 0.5s ease;
}

.button:hover .button-shine {
  left: 150%;
}

.primary-button {
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
  color: white;
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.3);
}

.primary-button:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 25px rgba(99, 102, 241, 0.4), var(--glow-primary);
  color: white;
}

.primary-button:hover .button-icon {
  transform: translateY(-3px);
}

.secondary-button {
  background: var(--dark-surface);
  color: var(--gray-200);
  border: 1px solid var(--dark-border);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
}

.secondary-button:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
  color: var(--primary-light);
  border-color: var(--primary);
}

.secondary-button:hover .button-icon {
  transform: translateY(-3px);
}

.hero-image {
  flex: 1;
  position: relative;
  height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translateX(30px);
  opacity: 0;
  animation: fadeInRight 0.8s 0.6s forwards;
}

.image-container {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%);
  width: 350px;
  height: 350px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  box-shadow: 0 15px 35px rgba(99, 102, 241, 0.25);
  border: 1px solid rgba(99, 102, 241, 0.2);
  z-index: 1;
}

.pulse-circle {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: transparent;
  border: 2px solid rgba(99, 102, 241, 0.3);
  animation: pulse 3s infinite;
  z-index: 0;
}

.glow-effect {
  position: absolute;
  width: 150%;
  height: 150%;
  background: radial-gradient(circle, rgba(99, 102, 241, 0.2) 0%, transparent 70%);
  z-index: 0;
  animation: rotate 15s linear infinite;
}

.security-icon, .wallet-icon, .xrpl-icon {
  position: absolute;
  font-size: 3.5rem;
  animation: float 4s ease-in-out infinite;
  filter: drop-shadow(0 10px 15px rgba(0, 0, 0, 0.2));
}

.security-icon {
  top: 20%;
  left: 30%;
  animation-delay: 0s;
}

.wallet-icon {
  bottom: 25%;
  right: 20%;
  animation-delay: 1s;
  font-size: 3.8rem;
}

.xrpl-icon {
  bottom: 35%;
  left: 25%;
  animation-delay: 2s;
  font-size: 4rem;
}

@keyframes float {
  0% {
    transform: translateY(0px) rotate(0deg);
  }
  50% {
    transform: translateY(-15px) rotate(5deg);
  }
  100% {
    transform: translateY(0px) rotate(0deg);
  }
}

@keyframes pulse {
  0% {
    transform: scale(1);
    opacity: 0.3;
  }
  50% {
    transform: scale(1.1);
    opacity: 0.1;
  }
  100% {
    transform: scale(1);
    opacity: 0.3;
  }
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes fadeInUp {
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@keyframes fadeInRight {
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.features-section {
  padding: var(--space-16) 0;
  position: relative;
}

.section-title {
  text-align: center;
  font-size: 2.5rem;
  margin-bottom: var(--space-12);
  color: var(--gray-100);
  background: linear-gradient(90deg, var(--primary-light) 0%, var(--accent-light) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  position: relative;
  display: inline-block;
  left: 50%;
  transform: translateX(-50%);
  letter-spacing: -0.02em;
}

.section-title::after {
  content: "";
  position: absolute;
  width: 80px;
  height: 4px;
  background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
  bottom: -15px;
  left: 50%;
  transform: translateX(-50%);
  border-radius: var(--border-radius-full);
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--space-8);
}

.animate-on-scroll {
  opacity: 0;
  transform: translateY(30px);
  transition: opacity 0.8s ease, transform 0.8s ease;
}

.animate-on-scroll.visible {
  opacity: 1;
  transform: translateY(0);
}

.feature-card {
  background: var(--dark-card);
  border-radius: var(--border-radius-lg);
  padding: var(--space-8);
  text-align: center;
  box-shadow: var(--shadow);
  transition: all var(--transition);
  border: 1px solid var(--dark-border);
  position: relative;
  overflow: hidden;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  transform: translateY(50px);
  opacity: 0;
}

.feature-card:nth-child(1) {
  transition-delay: 0.1s;
}

.feature-card:nth-child(2) {
  transition-delay: 0.3s;
}

.feature-card:nth-child(3) {
  transition-delay: 0.5s;
}

.feature-card.visible {
  transform: translateY(0);
  opacity: 1;
}

.feature-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 3px;
  background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
  opacity: 0;
  transition: opacity var(--transition);
}

.feature-card:hover {
  transform: translateY(-8px) scale(1.02);
  box-shadow: var(--shadow-xl), var(--glow-primary);
  border-color: rgba(99, 102, 241, 0.3);
}

.feature-card:hover::before {
  opacity: 1;
}

.feature-card-shine {
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.05),
    transparent
  );
  transition: left 0.5s ease;
  pointer-events: none;
}

.feature-card:hover .feature-card-shine {
  left: 100%;
}

.feature-icon-container {
  position: relative;
  width: 90px;
  height: 90px;
  margin: 0 auto var(--space-6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.feature-icon {
  font-size: 3rem;
  z-index: 2;
  transition: transform var(--transition);
}

.icon-backdrop {
  position: absolute;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, rgba(139, 92, 246, 0.05) 70%);
  border-radius: 50%;
  transition: transform var(--transition), opacity var(--transition);
  z-index: 1;
}

.feature-card:hover .feature-icon {
  transform: translateY(-5px) scale(1.1);
}

.feature-card:hover .icon-backdrop {
  transform: scale(1.1);
  opacity: 0.8;
}

.feature-card h3 {
  font-size: 1.4rem;
  margin-bottom: var(--space-3);
  color: var(--gray-100);
  font-weight: 700;
  letter-spacing: -0.01em;
  transition: color var(--transition);
}

.feature-card:hover h3 {
  background: linear-gradient(90deg, var(--primary-light) 0%, var(--accent-light) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.feature-card p {
  color: var(--gray-300);
  font-size: 1rem;
  line-height: 1.6;
}

.cta-section {
  margin: var(--space-8) 0 var(--space-16);
  padding: var(--space-12) var(--space-8);
  border-radius: var(--border-radius-lg);
  position: relative;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
  text-align: center;
  border: 1px solid rgba(99, 102, 241, 0.2);
}

.cta-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, 
    rgba(99, 102, 241, 0.1) 0%, 
    rgba(139, 92, 246, 0.15) 100%);
  z-index: -1;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.cta-content {
  position: relative;
  z-index: 1;
}

.cta-section h2 {
  font-size: 2.2rem;
  margin-bottom: var(--space-4);
  background: linear-gradient(135deg, var(--primary-light) 0%, var(--accent-light) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.cta-section p {
  font-size: 1.2rem;
  color: var(--gray-300);
  margin-bottom: var(--space-8);
  max-width: 700px;
  margin-left: auto;
  margin-right: auto;
}

.wide-button {
  display: inline-flex;
  padding: 1rem 2.5rem;
  font-size: 1.1rem;
  box-shadow: 0 8px 25px rgba(99, 102, 241, 0.3);
}

@media (max-width: 1024px) {
  .hero-title {
    font-size: 3rem;
  }
}

@media (max-width: 900px) {
  .hero-section {
    flex-direction: column;
    text-align: center;
    padding-top: var(--space-8);
  }
  
  .hero-line {
    margin-left: auto;
    margin-right: auto;
  }
  
  .hero-subtitle {
    margin-left: auto;
    margin-right: auto;
  }
  
  .hero-actions {
    justify-content: center;
  }
  
  .hero-title {
    font-size: 2.8rem;
  }
  
  .hero-image {
    height: 300px;
  }
  
  .section-title {
    font-size: 2rem;
  }
  
  .cta-section h2 {
    font-size: 1.8rem;
  }
  
  .cta-section p {
    font-size: 1.1rem;
  }
}

@media (max-width: 640px) {
  .hero-title {
    font-size: 2.3rem;
  }
  
  .hero-subtitle {
    font-size: 1.1rem;
  }
  
  .feature-card {
    padding: var(--space-6);
  }
  
  .cta-section {
    padding: var(--space-8) var(--space-4);
  }
  
  .wide-button {
    width: 100%;
  }
}
</style> 