import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const AUTH_DIR = path.join(__dirname, 'auth');
const AUTH_FILE = path.join(AUTH_DIR, 'facebook-session.json');

async function setup() {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  // Load existing session if available (so user doesn't re-login every time)
  const hasExistingSession = fs.existsSync(AUTH_FILE);

  console.log('='.repeat(60));
  console.log('Facebook & Messenger Auth Setup');
  console.log('='.repeat(60));
  console.log('');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ...(hasExistingSession ? { storageState: AUTH_FILE } : {}),
  });
  const page = await context.newPage();

  // Step 1: Check if already logged into Facebook
  console.log('Checking Facebook login status...');
  await page.goto('https://www.facebook.com/', { waitUntil: 'load' });
  await page.waitForTimeout(3_000);

  const isLoggedIn =
    (await page.locator('[aria-label="Your profile"], [aria-label="Account"], [data-pagelet="ProfileTail"]').count()) > 0 ||
    (await page.locator('div[role="navigation"]').count()) > 0 &&
    !(page.url().includes('/login'));

  if (!isLoggedIn || page.url().includes('/login')) {
    console.log('Not logged in. Please log in manually in the browser.');
    console.log('The script will wait until login is complete...');
    console.log('');

    if (!page.url().includes('/login')) {
      await page.goto('https://www.facebook.com/login', { waitUntil: 'load' });
    }

    // Wait for user to complete login — poll until URL leaves /login
    // and we can find logged-in navigation elements
    let loggedIn = false;
    while (!loggedIn) {
      await page.waitForTimeout(2_000);
      const currentUrl = page.url();
      if (!currentUrl.includes('/login') && !currentUrl.includes('/checkpoint')) {
        // Double-check by looking for nav elements that only appear when logged in
        await page.waitForTimeout(3_000);
        const navCount = await page.locator('div[role="navigation"]').count();
        if (navCount > 0) {
          loggedIn = true;
        }
      }
    }
    console.log('Facebook login complete!');
  } else {
    console.log('Already logged into Facebook.');
  }

  // Step 2: Establish Messenger session
  console.log('');
  console.log('Establishing Messenger session...');
  await page.goto('https://www.facebook.com/messages/', { waitUntil: 'load' });
  await page.waitForTimeout(3_000);

  const continueBtn = page.locator('button:has-text("Continue as")');
  if ((await continueBtn.count()) > 0) {
    console.log('Clicking "Continue as ..." on Messenger...');
    await continueBtn.first().click();
    try {
      await page
        .locator('a[href*="/t/"], [role="navigation"], [role="main"]')
        .first()
        .waitFor({ state: 'attached', timeout: 30_000 });
    } catch {
      // Continue anyway
    }
    await page.waitForTimeout(3_000);
    console.log('Messenger session established.');
  } else {
    // Check if we're actually in the Messenger inbox
    const inInbox = (await page.locator('a[href*="/t/"]').count()) > 0;
    if (inInbox) {
      console.log('Already logged into Messenger.');
    } else {
      console.log('Messenger inbox not detected. You may need to log in manually.');
      console.log('Navigating to Messenger login...');
      await page.goto('https://www.facebook.com/login', { waitUntil: 'load' });
      console.log('Please log in to Messenger in the browser.');
      // Wait for inbox
      try {
        await page
          .locator('a[href*="/t/"]')
          .first()
          .waitFor({ state: 'attached', timeout: 300_000 });
        console.log('Messenger login complete!');
      } catch {
        console.error('Timed out waiting for Messenger login.');
      }
    }
  }

  // Step 3: Save combined session
  const state = await context.storageState();
  fs.writeFileSync(AUTH_FILE, JSON.stringify(state, null, 2));

  console.log('');
  console.log(`Session saved to ${AUTH_FILE}`);
  console.log('You can now run: npm test');

  await browser.close();
}

setup().catch((err) => {
  console.error('Auth setup failed:', err);
  process.exit(1);
});
