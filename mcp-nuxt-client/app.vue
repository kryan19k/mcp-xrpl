<template>
  <div>
    <Navbar />
    <NuxtPage />
  </div>
</template>

<script setup>
// Configuration de l'application
import { onMounted } from 'vue';

onMounted(() => {
  // Assurer que l'état de l'application est cohérent au premier chargement
  if (typeof window !== 'undefined') {
    // Force la vérification du localStorage au démarrage
    const userData = localStorage.getItem('webauthn_user');
    console.log('État initial de connexion:', !!userData);
    
    // Si on est connecté et que la page est chargée pour la première fois
    // réinitialiser l'état pour résoudre le problème d'affichage initial
    if (userData && !sessionStorage.getItem('app_initialized')) {
      console.log('Réinitialisation forcée de l\'état de connexion');
      localStorage.removeItem('webauthn_user');
      sessionStorage.setItem('app_initialized', 'true');
      // Rafraîchir la page pour s'assurer que l'état est correctement appliqué
      window.location.reload();
    } else {
      sessionStorage.setItem('app_initialized', 'true');
    }
  }
});
</script>
<style>
:root {
  /* Palette minimaliste mode sombre bleu-violet */
  --primary: #6366F1;
  --primary-dark: #4F46E5;
  --primary-light: #818CF8;
  --accent: #8B5CF6;
  --accent-light: #A78BFA;
  
  /* Couleurs sombres */
  --dark-bg: #0F172A;
  --dark-surface: #1E293B;
  --dark-card: #1E293B;
  --dark-border: #334155;
  
  /* Niveaux de gris */
  --gray-50: #F9FAFB;
  --gray-100: #F3F4F6;
  --gray-200: #E5E7EB;
  --gray-300: #D1D5DB;
  --gray-400: #9CA3AF;
  --gray-500: #6B7280;
  --gray-600: #4B5563;
  --gray-700: #374151;
  --gray-800: #1F2937;
  --gray-900: #111827;
  
  /* Couleurs sémantiques */
  --success: #10B981;
  --warning: #F59E0B;
  --danger: #EF4444;
  --info: #3B82F6;
  
  /* Effets d'ombre */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.2);
  --shadow: 0 4px 6px rgba(0, 0, 0, 0.2);
  --shadow-md: 0 6px 10px rgba(0, 0, 0, 0.25);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.3);
  --shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.35);
  --shadow-inner: inset 0 2px 4px rgba(0, 0, 0, 0.2);
  
  /* Variables d'animation */
  --transition-fast: 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  --transition: 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  --transition-slow: 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  
  /* Variables de mise en page */
  --border-radius-sm: 0.25rem;
  --border-radius: 0.5rem;
  --border-radius-md: 0.75rem;
  --border-radius-lg: 1rem;
  --border-radius-xl: 1.5rem;
  --border-radius-full: 9999px;
  
  /* Espacement */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;
  --space-16: 4rem;
  
  /* Nouvelles variables pour effets */
  --glow-primary: 0 0 15px rgba(99, 102, 241, 0.3);
  --glow-accent: 0 0 15px rgba(139, 92, 246, 0.3);
  --backdrop-blur: blur(12px);
  --glass-bg: rgba(30, 41, 59, 0.7);
}

/* Reset et base */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-size: 16px;
  scroll-behavior: smooth;
}

body {
  background: var(--dark-bg);
  background-image: 
    radial-gradient(circle at 15% 50%, rgba(99, 102, 241, 0.08) 0%, transparent 25%),
    radial-gradient(circle at 85% 30%, rgba(139, 92, 246, 0.08) 0%, transparent 25%);
  color: var(--gray-200);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  line-height: 1.6;
  min-height: 100vh;
  font-weight: 400;
  overflow-x: hidden;
}

/* Typographie */
h1, h2, h3, h4, h5, h6 {
  font-weight: 700;
  line-height: 1.2;
  margin-bottom: var(--space-4);
  color: var(--gray-100);
  letter-spacing: -0.01em;
}

h1 {
  font-size: 2rem;
  background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  letter-spacing: -0.03em;
}

h2 {
  font-size: 1.5rem;
  letter-spacing: -0.02em;
}

h3 {
  font-size: 1.25rem;
}

p {
  margin-bottom: var(--space-4);
  color: var(--gray-300);
}

a {
  color: var(--primary-light);
  text-decoration: none;
  transition: color var(--transition);
  position: relative;
}

a:hover {
  color: var(--accent-light);
}

/* Boutons communs */
button, .button {
  background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
  color: white;
  border: none;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--border-radius);
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition);
  font-size: 0.9rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  box-shadow: var(--shadow-sm);
  letter-spacing: 0.02em;
  position: relative;
  overflow: hidden;
  z-index: 1;
}

button::before, .button::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
  transition: left 0.7s ease;
  z-index: -1;
}

button:hover::before, .button:hover::before {
  left: 100%;
}

button:hover, .button:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md), var(--glow-primary);
  opacity: 0.95;
}

button:active, .button:active {
  transform: translateY(0);
}

.secondary-button {
  background: transparent;
  color: var(--primary-light);
  border: 1px solid var(--primary);
  box-shadow: none;
  backdrop-filter: var(--backdrop-blur);
  -webkit-backdrop-filter: var(--backdrop-blur);
}

.secondary-button:hover {
  background: rgba(99, 102, 241, 0.15);
  border-color: var(--primary-light);
  box-shadow: var(--glow-primary);
}

button:disabled, .button:disabled {
  background: var(--gray-700);
  cursor: not-allowed;
  transform: none;
  opacity: 0.7;
}

/* Formulaires */
input, select, textarea {
  background-color: var(--dark-surface);
  border: 1px solid var(--dark-border);
  color: var(--gray-200);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--border-radius);
  font-size: 0.95rem;
  width: 100%;
  transition: all var(--transition-fast);
}

input:focus, select:focus, textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25), var(--glow-primary);
  outline: none;
}

label {
  display: block;
  margin-bottom: var(--space-2);
  font-weight: 500;
  color: var(--gray-300);
  font-size: 0.9rem;
}

/* Classes de mise en page */
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 var(--space-4);
  width: 100%;
}

/* Cartes */
.card {
  background-color: var(--dark-card);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow);
  border: 1px solid var(--dark-border);
  padding: var(--space-6);
  transition: transform var(--transition), box-shadow var(--transition);
  position: relative;
  overflow: hidden;
  backdrop-filter: var(--backdrop-blur);
  -webkit-backdrop-filter: var(--backdrop-blur);
}

.card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 3px;
  background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
  opacity: 0.8;
}

.card:hover {
  transform: translateY(-5px);
  box-shadow: var(--shadow-lg), var(--glow-primary);
}

/* Classes communes pour les composants */

/* Conteneurs */
.auth-container, .wallet-container {
  max-width: 540px;
  margin: var(--space-8) auto;
  padding: var(--space-4);
}

/* Cartes */
.auth-card, .wallet-card {
  background: var(--dark-card);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-lg);
  padding: var(--space-8);
  border: 1px solid rgba(99, 102, 241, 0.2);
  position: relative;
  overflow: hidden;
  backdrop-filter: var(--backdrop-blur);
  -webkit-backdrop-filter: var(--backdrop-blur);
  transition: transform var(--transition), box-shadow var(--transition);
}

.auth-card:hover, .wallet-card:hover {
  transform: translateY(-5px);
  box-shadow: var(--shadow-xl), var(--glow-primary);
}

.auth-card::before, .wallet-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 3px;
  background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
}

.error-card {
  background: rgba(239, 68, 68, 0.1);
  border-radius: var(--border-radius);
  padding: var(--space-4);
  border-left: 4px solid var(--danger);
  backdrop-filter: var(--backdrop-blur);
  -webkit-backdrop-filter: var(--backdrop-blur);
}

/* États des formulaires */
.loading-container {
  text-align: center;
  padding: var(--space-8);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.loading-spinner {
  width: 2.25rem;
  height: 2.25rem;
  border: 3px solid var(--gray-700);
  border-radius: 50%;
  border-top-color: var(--primary);
  animation: spin 1s linear infinite;
  margin-bottom: var(--space-4);
  box-shadow: var(--glow-primary);
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* Composants de wallet */
.wallet-info, .wallet-address {
  margin-bottom: var(--space-6);
  background: rgba(99, 102, 241, 0.05);
  border-radius: var(--border-radius);
  padding: var(--space-4);
  border: 1px solid rgba(99, 102, 241, 0.1);
  transition: all var(--transition);
}

.wallet-info:hover, .wallet-address:hover {
  box-shadow: var(--glow-primary);
  border-color: rgba(99, 102, 241, 0.3);
}

.address-box {
  background: var(--dark-surface);
  padding: var(--space-4);
  border-radius: var(--border-radius);
  word-break: break-all;
  font-family: 'Fira Code', 'SF Mono', monospace;
  border: 1px solid var(--dark-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
  transition: all var(--transition);
}

.address-box:hover {
  border-color: var(--primary);
  box-shadow: var(--glow-primary);
}

/* Utilitaires */
.flex {
  display: flex;
}

.flex-col {
  flex-direction: column;
}

.items-center {
  align-items: center;
}

.justify-between {
  justify-content: space-between;
}

.gap-2 {
  gap: var(--space-2);
}

.gap-4 {
  gap: var(--space-4);
}

.text-center {
  text-align: center;
}

.text-primary {
  color: var(--primary-light);
}

.text-accent {
  color: var(--accent-light);
}

.text-error {
  color: var(--danger);
}

.font-mono {
  font-family: 'Fira Code', 'SF Mono', monospace;
}

.rounded {
  border-radius: var(--border-radius);
}

.border {
  border: 1px solid var(--dark-border);
}

.p-4 {
  padding: var(--space-4);
}

.mb-4 {
  margin-bottom: var(--space-4);
}

/* Effets spéciaux */
::selection {
  background-color: rgba(99, 102, 241, 0.3);
  color: var(--gray-100);
}

/* Animation de page */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.page-enter-active {
  animation: fadeIn var(--transition);
}

/* Scrollbar personnalisée */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: var(--dark-surface);
}

::-webkit-scrollbar-thumb {
  background: var(--gray-700);
  border-radius: var(--border-radius-full);
}

::-webkit-scrollbar-thumb:hover {
  background: var(--primary-dark);
}
</style>
