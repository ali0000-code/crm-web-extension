/**
 * Chrome Extension Build Script
 *
 * Dev mode:  Individual JS files, no minification, direct copies
 * Prod mode: Bundled JS per manifest entry, minified, no source maps
 *            Uses config_production.js if available (falls back to config.js)
 *            Preserves dist/manifest.json if it already exists
 *
 * Usage:
 *   node build.mjs              # Development build
 *   node build.mjs --prod       # Production build (for Chrome Web Store)
 *   node build.mjs --watch      # Watch mode (development)
 */

import esbuild from 'esbuild';
import {
  cpSync, rmSync, mkdirSync, existsSync,
  statSync, readdirSync, readFileSync, writeFileSync,
} from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, 'dist');
const isProd = process.argv.includes('--prod');
const isWatch = process.argv.includes('--watch');

// ── Source manifest ──────────────────────────────────────────────────

const sourceManifest = JSON.parse(readFileSync(resolve(__dirname, 'manifest.json'), 'utf8'));

// ── Dev build entries (individual files, no bundling) ────────────────

const devEntries = {
  background: ['background-main.js', 'background.js'],
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

// ── Prod build: bundle definitions ───────────────────────────────────

// One output bundle per content_scripts manifest entry
const contentBundleNames = [
  'content-messenger.js',   // facebook.com/messages/*
  'content-facebook.js',    // facebook.com/*
  'content-sync.js',        // localhost/*, 127.0.0.1/*
];

// Popup bundle: config + auth + popup logic
const popupSources = ['config.js', 'fixed-key-auth.js', 'popup.js'];

// Directories to copy recursively
const staticDirs = ['icons'];

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Read a source file. In prod mode, config.js is substituted with
 * config_production.js if it exists, otherwise falls back to config.js.
 */
function readSource(filename) {
  if (filename === 'config.js' && isProd) {
    const prodConfig = resolve(__dirname, 'config_production.js');
    if (existsSync(prodConfig)) return readFileSync(prodConfig, 'utf8');
  }
  return readFileSync(resolve(__dirname, filename), 'utf8');
}

/** Concatenate source files in order and minify with esbuild */
async function bundleAndMinify(sourceFiles, outputPath) {
  const combined = sourceFiles.map(f => readSource(f)).join('\n;\n');
  const { code } = await esbuild.transform(combined, {
    minify: true,
    target: ['chrome110'],
    charset: 'utf8',
    legalComments: 'none',
    drop: ['debugger'],
    pure: ['console.log', 'console.warn', 'console.info', 'console.debug'],
  });
  writeFileSync(outputPath, code);
}

/**
 * Process popup.html for production:
 *  - Remove all <script> tags
 *  - Add single <script src="popup.js"></script> in <head>
 */
function buildPopupHtml() {
  let html = readFileSync(resolve(__dirname, 'popup.html'), 'utf8');
  // Remove all script tags (with any content between them)
  html = html.replace(/<\s*script\b[^>]*>[\s\S]*?<\/\s*script\s*>/gi, '');
  // Collapse runs of 3+ newlines down to 2
  html = html.replace(/(\n\s*){3,}/g, '\n\n');
  // Add single script tag in <head>
  html = html.replace('</head>', '  <script src="popup.js"></script>\n</head>');
  writeFileSync(resolve(DIST, 'popup.html'), html);
}

/** Generate production manifest with bundled content-script filenames */
function buildProdManifest() {
  const manifest = JSON.parse(JSON.stringify(sourceManifest));
  manifest.content_scripts = manifest.content_scripts.map((entry, i) => ({
    ...entry,
    js: [contentBundleNames[i]],
  }));
  return manifest;
}

/** Copy icon directories */
function copyDirs() {
  for (const dir of staticDirs) {
    const src = resolve(__dirname, dir);
    if (existsSync(src) && statSync(src).isDirectory()) {
      cpSync(src, resolve(DIST, dir), { recursive: true });
    }
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`;
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
    console.log(`    ${file.padEnd(36)} ${size}`);
  }
  console.log(`\n  Total JS: ${formatSize(totalSize)}`);
  console.log(`  Mode:     ${isProd ? 'production (bundled + minified)' : 'development'}\n`);
}

function getDevCategory(filename) {
  for (const [cat, files] of Object.entries(devEntries)) {
    if (files.includes(filename)) return cat;
  }
  return 'other';
}

function logDevSummary() {
  const files = readdirSync(DIST).filter(f => f.endsWith('.js'));
  let totalSize = 0;
  const rows = files.map(f => {
    const size = statSync(resolve(DIST, f)).size;
    totalSize += size;
    return { file: f, size: formatSize(size), category: getDevCategory(f) };
  });

  console.log('\n  Build output (dist/):\n');
  for (const { file, size, category } of rows) {
    console.log(`    ${category.padEnd(12)} ${file.padEnd(36)} ${size}`);
  }
  console.log(`\n  Total JS: ${formatSize(totalSize)}`);
  console.log(`  Mode:     development\n`);
}

// ── Build ────────────────────────────────────────────────────────────

// In prod mode, preserve dist/manifest.json if it exists
let savedManifest = null;
if (isProd) {
  const mp = resolve(DIST, 'manifest.json');
  if (existsSync(mp)) {
    savedManifest = readFileSync(mp, 'utf8');
  }
}

// Clean dist
if (existsSync(DIST)) rmSync(DIST, { recursive: true });
mkdirSync(DIST, { recursive: true });

if (isProd) {
  // ── PRODUCTION BUILD ───────────────────────────────────────────────

  // 1. Bundle each content_scripts entry into one file
  for (let i = 0; i < sourceManifest.content_scripts.length; i++) {
    const sources = sourceManifest.content_scripts[i].js;
    await bundleAndMinify(sources, resolve(DIST, contentBundleNames[i]));
  }

  // 2. Bundle popup (config + fixed-key-auth + popup.js)
  await bundleAndMinify(popupSources, resolve(DIST, 'popup.js'));

  // 3. Minify background.js (concatenate config + background for production)
  const bgConfig = readSource('config.js');
  const bgMain = readFileSync(resolve(__dirname, 'background.js'), 'utf8');
  const { code: bgMin } = await esbuild.transform(bgConfig + '\n;\n' + bgMain, {
    minify: true,
    target: ['chrome110'],
    charset: 'utf8',
    legalComments: 'none',
    drop: ['debugger'],
    pure: ['console.log', 'console.warn', 'console.info', 'console.debug'],
  });
  writeFileSync(resolve(DIST, 'background-main.js'), bgMin);

  // 4. Output standalone messengerInject.js for SPA injection from background.js
  const messengerCode = readFileSync(resolve(__dirname, 'messengerInject.js'), 'utf8');
  const { code: messengerMin } = await esbuild.transform(messengerCode, {
    minify: true,
    target: ['chrome110'],
    charset: 'utf8',
    legalComments: 'none',
    drop: ['debugger'],
    pure: ['console.log', 'console.warn', 'console.info', 'console.debug'],
  });
  writeFileSync(resolve(DIST, 'messengerInject.js'), messengerMin);

  // 5. Process popup.html (remove scripts, add single popup.js in <head>)
  buildPopupHtml();

  // 6. Copy CSS + icon directories
  const cssSrc = resolve(__dirname, 'popup.css');
  if (existsSync(cssSrc)) cpSync(cssSrc, resolve(DIST, 'popup.css'));
  copyDirs();

  // 7. Handle manifest.json — don't overwrite if it already existed
  if (savedManifest) {
    writeFileSync(resolve(DIST, 'manifest.json'), savedManifest);
    console.log('  manifest.json: preserved existing (not overwritten)');
  } else {
    const prodManifest = buildProdManifest();
    writeFileSync(
      resolve(DIST, 'manifest.json'),
      JSON.stringify(prodManifest, null, 2),
    );
    console.log('  manifest.json: generated with bundled filenames');
  }

  logSummary();

} else {
  // ── DEVELOPMENT BUILD ──────────────────────────────────────────────

  // Copy static files as-is
  for (const f of ['manifest.json', 'popup.html', 'popup.css', 'jquery-3.7.1.min.js']) {
    const src = resolve(__dirname, f);
    if (existsSync(src)) cpSync(src, resolve(DIST, f));
  }
  copyDirs();

  const buildOptions = {
    entryPoints: Object.values(devEntries).flat().map(f => resolve(__dirname, f)),
    outdir: DIST,
    bundle: false,
    minify: false,
    sourcemap: false,
    target: ['chrome110'],
    charset: 'utf8',
    legalComments: 'inline',
    logLevel: 'warning',
  };

  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('\n  Watching for changes... (Ctrl+C to stop)\n');
  } else {
    await esbuild.build(buildOptions);
    logDevSummary();
  }
}
