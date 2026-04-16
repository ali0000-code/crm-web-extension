/**
 * Chrome Extension Build Script
 *
 * Dev mode:  Individual JS files, no minification, direct copies
 * Prod mode: Bundled JS per manifest content_scripts entry, minified, no source maps
 *            Uses config_production.js in place of config.js when present
 *
 * NOTE: This build script READS the root manifest.json (to learn what to
 *       bundle) but does NOT copy it into the output folder. Instead, for
 *       production builds it copies the hand-maintained
 *       `manifest.production.json` (at the extension root, git-ignored) into
 *       `production/manifest.json`. Edit the root master file, not the copy.
 *
 * Usage:
 *   node build.mjs              # Development build
 *   node build.mjs --prod       # Production build (for Chrome Web Store)
 *   node build.mjs --watch      # Watch mode (development)
 */

import esbuild from 'esbuild';
import AdmZip from 'adm-zip';
import {
  cpSync, rmSync, mkdirSync, existsSync,
  statSync, readdirSync, readFileSync, writeFileSync,
} from 'fs';
import { resolve, dirname, relative, sep } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, 'production');
const isProd = process.argv.includes('--prod');
const isWatch = process.argv.includes('--watch');

// ── Source manifest (read for bundling info only — never written out) ─

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

// One output bundle per content_scripts manifest entry (index-aligned).
// These filenames must match what your manual manifest.json references.
const contentBundleNames = [
  'content-messenger.js',   // facebook.com/messages/*
  'content-facebook.js',    // facebook.com/groups/*
  'content-sync.js',        // localhost/*, 127.0.0.1/*, app.chatpilotcrm.com/*
];

// Popup bundle: config + auth + popup logic
const popupSources = ['config.js', 'fixed-key-auth.js', 'popup.js'];

// Directories to copy recursively
const staticDirs = ['icons', 'fonts'];

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
    pure: ['console.log', 'console.warn', 'console.info', 'console.debug', 'console.error'],
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
  writeFileSync(resolve(OUT, 'popup.html'), html);
}

/**
 * Zip the entire production/ folder into production/production.zip.
 * Excludes production.zip itself (from any prior build) to prevent
 * self-inclusion. Uses forward-slash paths inside the archive for
 * cross-platform compatibility.
 */
function zipProduction() {
  const zipPath = resolve(OUT, 'production.zip');
  // Remove any previous zip so it is not included in itself.
  if (existsSync(zipPath)) rmSync(zipPath);

  const zip = new AdmZip();

  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = resolve(dir, name);
      const rel = relative(OUT, full).split(sep).join('/');
      if (rel === 'production.zip') continue;
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else {
        zip.addLocalFile(full, dirname(rel) === '.' ? '' : dirname(rel));
      }
    }
  };
  walk(OUT);

  zip.writeZip(zipPath);
  return statSync(zipPath).size;
}

/** Copy icon directories */
function copyDirs() {
  for (const dir of staticDirs) {
    const src = resolve(__dirname, dir);
    if (existsSync(src) && statSync(src).isDirectory()) {
      cpSync(src, resolve(OUT, dir), { recursive: true });
    }
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`;
}

function logSummary() {
  const files = readdirSync(OUT).filter(f => f.endsWith('.js'));
  let totalSize = 0;
  const rows = files.map(f => {
    const size = statSync(resolve(OUT, f)).size;
    totalSize += size;
    return { file: f, size: formatSize(size) };
  });

  console.log('\n  Build output (production/):\n');
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
  const files = readdirSync(OUT).filter(f => f.endsWith('.js'));
  let totalSize = 0;
  const rows = files.map(f => {
    const size = statSync(resolve(OUT, f)).size;
    totalSize += size;
    return { file: f, size: formatSize(size), category: getDevCategory(f) };
  });

  console.log('\n  Build output (production/):\n');
  for (const { file, size, category } of rows) {
    console.log(`    ${category.padEnd(12)} ${file.padEnd(36)} ${size}`);
  }
  console.log(`\n  Total JS: ${formatSize(totalSize)}`);
  console.log(`  Mode:     development\n`);
}

// ── Build ────────────────────────────────────────────────────────────

// Ensure output folder exists, but DO NOT wipe it — overwrite files in place.
// This preserves anything you placed there manually (notably manifest.json).
// If you rename a bundle or remove a source, delete the stale file yourself
// or remove the production/ folder and rebuild.
mkdirSync(OUT, { recursive: true });

if (isProd) {
  // ── PRODUCTION BUILD ───────────────────────────────────────────────

  // 1. Bundle each content_scripts entry from the manifest into one file
  //    (readSource() swaps config.js → config_production.js automatically)
  const contentScripts = sourceManifest.content_scripts || [];
  if (contentScripts.length !== contentBundleNames.length) {
    throw new Error(
      `manifest.json has ${contentScripts.length} content_scripts entries ` +
      `but contentBundleNames has ${contentBundleNames.length}. ` +
      `Update contentBundleNames in build.mjs to match.`
    );
  }
  for (let i = 0; i < contentScripts.length; i++) {
    const sources = contentScripts[i].js;
    await bundleAndMinify(sources, resolve(OUT, contentBundleNames[i]));
  }

  // 2. Bundle popup (config + fixed-key-auth + popup.js)
  await bundleAndMinify(popupSources, resolve(OUT, 'popup.js'));

  // 3. Minify background.js (concatenate config + background for production)
  const bgConfig = readSource('config.js');
  const bgMain = readFileSync(resolve(__dirname, 'background.js'), 'utf8');
  const { code: bgMin } = await esbuild.transform(bgConfig + '\n;\n' + bgMain, {
    minify: true,
    target: ['chrome110'],
    charset: 'utf8',
    legalComments: 'none',
    drop: ['debugger'],
    pure: ['console.log', 'console.warn', 'console.info', 'console.debug', 'console.error'],
  });
  writeFileSync(resolve(OUT, 'background-main.js'), bgMin);

  // 4. Output standalone messengerInject.js for SPA injection from background.js
  const messengerCode = readFileSync(resolve(__dirname, 'messengerInject.js'), 'utf8');
  const { code: messengerMin } = await esbuild.transform(messengerCode, {
    minify: true,
    target: ['chrome110'],
    charset: 'utf8',
    legalComments: 'none',
    drop: ['debugger'],
    pure: ['console.log', 'console.warn', 'console.info', 'console.debug', 'console.error'],
  });
  writeFileSync(resolve(OUT, 'messengerInject.js'), messengerMin);

  // 5. Process popup.html (remove scripts, add single popup.js in <head>)
  buildPopupHtml();

  // 6. Copy CSS + icon directories
  const cssSrc = resolve(__dirname, 'popup.css');
  if (existsSync(cssSrc)) cpSync(cssSrc, resolve(OUT, 'popup.css'));
  copyDirs();

  // 7. Copy manifest.production.json → production/manifest.json (if master exists)
  //    This is the master copy of the production manifest, hand-edited, git-ignored.
  //    Edit the master at the extension root, not the one in production/.
  const prodManifestSrc = resolve(__dirname, 'manifest.production.json');
  if (existsSync(prodManifestSrc)) {
    cpSync(prodManifestSrc, resolve(OUT, 'manifest.json'));
    console.log('  manifest.json:   copied from manifest.production.json');
  } else {
    console.log('  manifest.json:   ⚠ manifest.production.json not found at root — production/manifest.json not updated');
  }

  logSummary();

  // Zip everything in production/ into production/production.zip
  // (run after logSummary so the summary lists the .js outputs only)
  const zipSize = zipProduction();
  console.log(`  production.zip:  ${formatSize(zipSize)}  (ready for Chrome Web Store upload)\n`);

} else {
  // ── DEVELOPMENT BUILD ──────────────────────────────────────────────

  // Copy static files as-is (manifest.json intentionally excluded — manual)
  for (const f of ['popup.html', 'popup.css', 'jquery-3.7.1.min.js']) {
    const src = resolve(__dirname, f);
    if (existsSync(src)) cpSync(src, resolve(OUT, f));
  }
  copyDirs();

  const buildOptions = {
    entryPoints: Object.values(devEntries).flat().map(f => resolve(__dirname, f)),
    outdir: OUT,
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
