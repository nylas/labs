// Main exports for the Nylas-Clerk integration SDK

// Core functionality
export { createNylasGrant } from "./auth.js"
// Utilities
export { handlePromise } from "./lib/handle-promise.js"
// Types
export type { Failure, GoResponse, Success } from "./types.js"
export { failure, success } from "./types.js"

// Version information
export const VERSION = "1.0.0"
export const PACKAGE_NAME = "nylas-clerk-integration"
