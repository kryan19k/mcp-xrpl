import { defineNuxtConfig } from "nuxt/config";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },

  typescript: {
      strict: true, // Enable strict TypeScript checks
      typeCheck: true, // Optional: Add type checking during development
  },

  // Make environment variables available server-side
  runtimeConfig: {
      // Private keys are only available on the server
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      // Public keys that are exposed to the client (if needed)
      public: {},
  },

  // Load dotenv for development
  modules: [
      // You might potentially use a dotenv module, but Nuxt 3 handles .env automatically
      // '@nuxtjs/dotenv', // Example, usually not needed in Nuxt 3
  ],

  compatibilityDate: "2025-04-06",
});