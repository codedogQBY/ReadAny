/// <reference types="vite/client" />

// Injected by vite.config.ts from src-tauri/Cargo.lock — the real Tauri
// framework version shown on the About tech-stack cards.
declare const __TAURI_VERSION__: string;

// Injected by vite.config.ts from the resolved typescript/package.json —
// same pattern, keeps a dev-only manifest out of the client bundle.
declare const __TS_VERSION__: string;

declare interface PromiseConstructor {
  withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
}

// foliate-js is a pure JS library with no type declarations
declare module "foliate-js/view.js";
declare module "foliate-js/epub.js";
declare module "foliate-js/pdf.js";
declare module "foliate-js/mobi.js";
declare module "foliate-js/comic-book.js";
declare module "foliate-js/fb2.js";
declare module "foliate-js/epubcfi.js";
declare module "foliate-js/paginator.js";
declare module "foliate-js/overlayer.js";
declare module "foliate-js/progress.js";
declare module "foliate-js/vendor/fflate.js";
declare module "foliate-js/vendor/zip.js";
