/**
 * Background Service Worker Entry Point
 *
 * Loads configuration first, then the main background script.
 * In production builds, config is inlined directly into background.js
 * so this file is not needed.
 */
importScripts('config.js', 'background.js');
