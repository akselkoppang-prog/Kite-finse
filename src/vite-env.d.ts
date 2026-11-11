/// <reference types="vite/client" />

/** Settes av Vite ved bygging (se vite.config.ts og scripts/version.mjs). */
declare const __BUILD_INFO__: import('./lib/version').BuildInfo | undefined;
