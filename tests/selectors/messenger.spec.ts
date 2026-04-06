import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { MESSENGER_SELECTORS, type SelectorDef } from './selector-config';

const AUTH_FILE = path.join(__dirname, '..', '..', 'auth', 'facebook-session.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function riskTag(risk: string): string {
  return `[${risk.toUpperCase()}]`;
}

/**
 * Facebook Messages may show a landing page with "Continue as <Name>" instead
 * of the inbox. This clicks through if needed.
 */
async function enterMessengerInbox(page: Page) {
  await page.goto('https://www.facebook.com/messages/', { waitUntil: 'load' });
  await page.waitForTimeout(3_000);

  // Check if we landed on the marketing/splash page
  const continueBtn = page.locator('button:has-text("Continue as")');
  if ((await continueBtn.count()) > 0) {
    console.log('  Landing page detected — clicking "Continue as ..." to enter inbox');
    await continueBtn.first().click();

    // Don't use networkidle — Facebook keeps persistent connections.
    // Wait for the inbox to render by looking for conversation links or role="main".
    try {
      await page
        .locator('a[href*="/t/"], [role="navigation"], [role="main"]')
        .first()
        .waitFor({ state: 'attached', timeout: 30_000 });
    } catch {
      console.log('  Inbox elements not detected after click, continuing anyway...');
    }
    await page.waitForTimeout(5_000);
  } else {
    // Already in inbox or unknown state — just wait for hydration
    await page.waitForTimeout(5_000);
  }

  // Verify we're in the inbox
  const inInbox =
    (await page.locator('[role="main"]').count()) > 0 ||
    (await page.locator('a[href*="/t/"]').count()) > 0;

  if (!inInbox) {
    // Try direct /t/ URL as fallback
    console.log('  Inbox not detected, trying direct navigation to /t/');
    await page.goto('https://www.facebook.com/messages/t/', { waitUntil: 'load' });
    await page.waitForTimeout(5_000);
  }
}

async function openFirstConversation(page: Page) {
  const link = page.locator(
    'a[href*="/t/"]:not([href*="/t/user"]):not([href*="/t/group"])',
  );
  // Wait up to 10s for at least one conversation link to appear
  try {
    await link.first().waitFor({ state: 'attached', timeout: 10_000 });
  } catch {
    throw new Error(
      'No conversation links found — cannot navigate into a chat.\n' +
        'Current URL: ' + page.url(),
    );
  }

  // Extract the href and navigate directly — avoids overlay interception issues
  const href = await link.first().getAttribute('href');
  if (href) {
    const url = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
    await page.goto(url, { waitUntil: 'load' });
  } else {
    // Fallback: force-click through any overlay
    await link.first().click({ force: true });
    await page.waitForLoadState('load');
  }
  await page.waitForTimeout(5_000);
}

// ---------------------------------------------------------------------------
// Session check
// ---------------------------------------------------------------------------

test.beforeAll(() => {
  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error(
      `Facebook session not found at ${AUTH_FILE}.\nRun "npm run auth:setup" first to log in.`,
    );
  }
  const stat = fs.statSync(AUTH_FILE);
  const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
  if (ageDays > 30) {
    throw new Error(
      `Facebook session is ${Math.round(ageDays)} days old and likely expired.\nRun "npm run auth:setup" to re-authenticate.`,
    );
  }
});

// ---------------------------------------------------------------------------
// Tests — one per selector
// ---------------------------------------------------------------------------

// Split selectors into those that need a conversation open and those that don't
const mainPageSelectors: [string, SelectorDef][] = [];
const conversationSelectors: [string, SelectorDef][] = [];

for (const [name, def] of Object.entries(MESSENGER_SELECTORS)) {
  if (def.requiresNavigation) {
    conversationSelectors.push([name, def]);
  } else {
    mainPageSelectors.push([name, def]);
  }
}

// --- Main page selectors (facebook.com/messages landing) ---
test.describe('Messenger — main page selectors', () => {
  let sharedPage: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      storageState: AUTH_FILE,
    });
    sharedPage = await context.newPage();
    await enterMessengerInbox(sharedPage);
  });

  test.afterAll(async () => {
    await sharedPage?.context().close();
  });

  for (const [name, def] of mainPageSelectors) {
    test(`${riskTag(def.risk)} ${name}: ${def.description}`, async () => {
      const count = await sharedPage.locator(def.selector).count();

      if (def.required) {
        expect(
          count,
          `Selector "${name}" matched 0 elements — expected at least 1.\nSelector: ${def.selector}`,
        ).toBeGreaterThan(0);
      } else {
        // Warning-only: test passes but logs the result
        if (count === 0) {
          console.warn(
            `⚠ WARNING ${riskTag(def.risk)} ${name}: 0 elements found (selector may be broken)\n  Selector: ${def.selector}`,
          );
        }
      }

      console.log(
        `  ${riskTag(def.risk)} ${name}: ${count} found`,
      );
    });
  }
});

// --- Conversation selectors (requires clicking into a chat) ---
test.describe('Messenger — conversation selectors', () => {
  let sharedPage: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      storageState: AUTH_FILE,
    });
    sharedPage = await context.newPage();
    await enterMessengerInbox(sharedPage);
    await openFirstConversation(sharedPage);
  });

  test.afterAll(async () => {
    await sharedPage?.context().close();
  });

  for (const [name, def] of conversationSelectors) {
    test(`${riskTag(def.risk)} ${name}: ${def.description}`, async () => {
      const count = await sharedPage.locator(def.selector).count();

      if (def.required) {
        expect(
          count,
          `Selector "${name}" matched 0 elements — expected at least 1.\nSelector: ${def.selector}`,
        ).toBeGreaterThan(0);
      } else {
        if (count === 0) {
          console.warn(
            `⚠ WARNING ${riskTag(def.risk)} ${name}: 0 elements found (selector may be broken)\n  Selector: ${def.selector}`,
          );
        }
      }

      console.log(
        `  ${riskTag(def.risk)} ${name}: ${count} found`,
      );
    });
  }
});
