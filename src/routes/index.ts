/**
 * Route composition: re-exports main app router and shared search for xrpc/ingester.
 * Domain routes: pages, profile, books, comments, api; main.tsx composes them.
 */
export { searchBooks } from "./lib";
export { mainRouter, createRouter } from "./main";
