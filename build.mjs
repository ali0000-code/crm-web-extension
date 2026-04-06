/**
 * Chrome Extension Build Script
 *
 * Uses esbuild to minify JS files without bundling/wrapping, preserving
 * the global scope sharing that Chrome extension content scripts rely on.
 *
 * Usage:
 *   node build.mjs              # Development build (no minification)
 *   node build.mjs --prod       # Production build (minified + source maps)
 *   node build.mjs --watch      # Watch mode (rebuilds on changes)
 *   node build.mjs --prod --watch
 */

import esbuild from 'esbuild';
import { cpSync, rmSync, mkdirSync, existsSync, statSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, 'dist');
const isProd = process.argv.includes('--prod');
const isWatch = process.argv.includes('--watch');

// ── Entry points by category ──────────────────────────────────────────

const entries = {
  background: ['background.js'],
  popup:      ['popup.js'],
  lib:        ['config.js', 'fixed-key-auth.js'],
  content:    [
    'messengerInject.js',
    'groupsInject.js',
    'notesInject.js',
    'facebookAutoLink.js',
    'facebook-account-validator.js',
    'webappSync.js',
  ],
};

const allJsFiles = Object.values(entries).flat();

// Static assets to copy as-is
const staticFiles = [
  'manifest.json',
  'popup.html',
  'popup.css',
  'jquery-3.7.1.min.js',
];

// Directories to copy recursively (if they exist)
const staticDirs = ['icons'];

// ── Helpers ───────────────────────────────────────────────────────────

function copyStatic() {
  for (const file of staticFiles) {
    const src = resolve(__dirname, file);
    if (existsSync(src)) {
      cpSync(src, resolve(DIST, file));
    }
  }
  for (const dir of staticDirs) {
    const src = resolve(__dirname, dir);
    if (existsSync(src) && statSync(src).isDirectory()) {
      cpSync(src, resolve(DIST, dir), { recursive: true });
    }
  }
}

function logSummary() {
  const files = readdirSync(DIST).filter(f => f.endsWith('.js'));
  let totalSize = 0;
  const rows = files.map(f => {
    const size = statSync(resolve(DIST, f)).size;
    totalSize += size;
    return { file: f, size: formatSize(size) };
  });

  console.log('\n  Build output (dist/):\n');
  for (const { file, size } of rows) {
    const category = getCategory(file);
    console.log(`    ${category.padEnd(12)} ${file.padEnd(36)} ${size}`);
  }
  console.log(`\n  Total JS: ${formatSize(totalSize)}`);
  console.log(`  Mode:     ${isProd ? 'production (minified)' : 'development'}\n`);
}

function getCategory(filename) {
  for (const [cat, files] of Object.entries(entries)) {
    if (files.includes(filename)) return cat;
  }
  return 'other';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`;
}

// ── Build ─────────────────────────────────────────────────────────────

// Clean and recreate dist
if (existsSync(DIST)) {
  rmSync(DIST, { recursive: true });
}
mkdirSync(DIST, { recursive: true });

// Copy static assets
copyStatic();

// esbuild options — bundle:false means each file is transformed independently
// with no IIFE wrapping, preserving global scope sharing for content scripts
const buildOptions = {
  entryPoints: allJsFiles.map(f => resolve(__dirname, f)),
  outdir: DIST,
  bundle: false,
  minify: isProd,
  sourcemap: isProd ? 'linked' : false,
  target: ['chrome110'],
  charset: 'utf8',
  legalComments: isProd ? 'none' : 'inline',
  logLevel: 'warning',
  // Strip console.log/warn/info/debug in production (keep console.error for critical issues)
  ...(isProd && {
    drop: ['debugger'],
    pure: ['console.log', 'console.warn', 'console.info', 'console.debug'],
  }),
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('\n  Watching for changes... (Ctrl+C to stop)\n');
  // Keep process alive
} else {
  await esbuild.build(buildOptions);
  logSummary();
}
