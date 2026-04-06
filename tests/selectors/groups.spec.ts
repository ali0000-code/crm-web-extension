import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { GROUPS_SELECTORS, FACEBOOK_GROUP_URL, type SelectorDef } from './selector-config';

const AUTH_FILE = path.join(__dirname, '..', '..', 'auth', 'facebook-session.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function riskTag(risk: string): string {
  return `[${risk.toUpperCase()}]`;
}

function getGroupUrl(): string {
  const url = process.env.FACEBOOK_GROUP_URL || FACEBOOK_GROUP_URL;
  // Ensure we're on the members page
  if (!url.includes('/members')) {
    return url.replace(/\/$/, '') + '/members';
  }
  return url;
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

test.describe('Groups — member page selectors', () => {
  let sharedPage: Page;

  test.beforeAll(async ({ browser }) => {
    const groupUrl = getGroupUrl();
    const context = await browser.newContext({
      storageState: AUTH_FILE,
    });
    sharedPage = await context.newPage();
    await sharedPage.goto(groupUrl, { waitUntil: 'load' });
    await sharedPage.waitForTimeout(5_000);

    // Scroll down to trigger lazy-loading of member rows
    await sharedPage.evaluate(() => window.scrollBy(0, 800));
    await sharedPage.waitForTimeout(2_000);
  });

  test.afterAll(async () => {
    await sharedPage?.context().close();
  });

  for (const [name, def] of Object.entries(GROUPS_SELECTORS)) {
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
