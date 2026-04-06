/**
 * CRM Extension Selector Test Utility
 *
 * Run this in the browser console on Facebook pages to test selectors.
 *
 * Usage:
 *   - On Groups page: Copy and paste this entire file into console
 *   - On Messenger: Copy and paste this entire file into console
 *   - Results show which selectors are working/broken
 *
 * Or use individual functions:
 *   - testGroupsSelectors()   - Test selectors on Facebook Groups
 *   - testMessengerSelectors() - Test selectors on Messenger
 *   - testAllSelectors()      - Run all tests
 */

(function() {
  'use strict';

  // ============================================
  // GROUPS SELECTORS (from groupsInject.js)
  // ============================================
  const GROUPS_SELECTORS = {
    // Facebook DOM selectors (these can break)
    MEMBER_ROW: {
      selector: 'div[role="listitem"][data-visualcompletion="ignore-dynamic"]',
      description: 'Group member list items',
      risk: 'medium',
      required: true,
      minExpected: 1
    },
    GROUP_PROFILE_LINK: {
      selector: 'a[href*="/groups/"][href*="/user/"]',
      description: 'Profile links in groups',
      risk: 'low',
      required: true,
      minExpected: 1
    },
    ROLE_BUTTON: {
      selector: 'div[role="button"]',
      description: 'Role-based buttons',
      risk: 'low',
      required: false,
      minExpected: 1
    },
    ADD_FRIEND_ARIA: {
      selector: '[aria-label*="Add Friend"], [aria-label*="Add friend"], [aria-label*="add friend"]',
      description: 'Add friend buttons (aria-label)',
      risk: 'medium',
      required: false,
      minExpected: 0
    },
    SVG_ARIA_LABEL: {
      selector: 'svg[aria-label]',
      description: 'SVG elements with aria-label',
      risk: 'low',
      required: false,
      minExpected: 1
    }
  };

  // ============================================
  // MESSENGER SELECTORS (from messengerInject.js)
  // ============================================
  const MESSENGER_SELECTORS = {
    CONVERSATION_LINK: {
      selector: 'a[href*="/t/"]:not([href*="/t/user"]):not([href*="/t/group"])',
      description: 'Conversation links in chat list',
      risk: 'low',
      required: true,
      minExpected: 1
    },
    CONVERSATION_NAME: {
      selector: 'span[dir="auto"] span',
      description: 'Conversation name spans',
      risk: 'medium',
      required: true,
      minExpected: 1
    },
    CHATS_TITLE: {
      selector: 'span.x1lliihq.x1plvlek.xryxfnj.x1n2onr6.xyejjpt.x15dsfln.x193iq5w.xeuugli.x13faqbe.x1vvkbs.x1s928wv.xhkezso.x1gmr53x.x1cpjm7i.x1fgarty.x1943h6x.x1xmvt09.xngnso2.x1xlr1w8.xw2npq5.x14z4hjw.x3x7a5m.xq9mrsl[dir="auto"]',
      description: 'Chats title header (HIGH RISK - auto-generated classes)',
      risk: 'high',
      required: false,
      minExpected: 0
    },
    CHATS_TITLE_FALLBACK: {
      selector: 'span[dir="auto"]',
      description: 'Chats title fallback',
      risk: 'low',
      required: true,
      minExpected: 1
    },
    HEADER_RIGHT_CONTROLS: {
      selector: 'div.x78zum5.x1q0g3np.x1diwwjn',
      description: 'Header right controls (HIGH RISK)',
      risk: 'high',
      required: false,
      minExpected: 0
    },
    CHAT_CONTAINER: {
      selector: '[role="main"]',
      description: 'Main chat container',
      risk: 'low',
      required: true,
      minExpected: 1
    },
    COMPOSER_ACTIONS: {
      selector: 'div.x6s0dn4.xpvyfi4.x78zum5.xl56j7k.x162z183',
      description: 'Composer actions bar (HIGH RISK)',
      risk: 'high',
      required: false,
      minExpected: 0
    },
    MESSAGE_INPUT: {
      selector: 'div[contenteditable="true"][role="textbox"]',
      description: 'Message input box',
      risk: 'low',
      required: false,
      minExpected: 0
    },
    MESSAGE_INPUT_FALLBACK: {
      selector: 'div[contenteditable="true"]:not([role="button"])',
      description: 'Message input fallback',
      risk: 'low',
      required: false,
      minExpected: 0
    },
    PROFILE_IMG_SCONTENT: {
      selector: 'img[src*="scontent"]',
      description: 'Profile images (scontent CDN)',
      risk: 'low',
      required: true,
      minExpected: 1
    },
    CONVERSATION_HEADER_H1: {
      selector: 'h1[dir="auto"]',
      description: 'Conversation header H1',
      risk: 'low',
      required: false,
      minExpected: 0
    }
  };

  // ============================================
  // TEST FUNCTIONS
  // ============================================

  function testSelector(name, config) {
    const elements = document.querySelectorAll(config.selector);
    const count = elements.length;
    const passed = count >= config.minExpected;

    return {
      name,
      selector: config.selector,
      description: config.description,
      risk: config.risk,
      required: config.required,
      count,
      minExpected: config.minExpected,
      passed,
      status: passed ? '✅ PASS' : (config.required ? '❌ FAIL' : '⚠️ WARN'),
      elements: elements
    };
  }

  function testSelectorGroup(name, selectors) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${name} SELECTOR TEST`);
    console.log(`${'='.repeat(60)}\n`);

    const results = [];
    let passed = 0;
    let failed = 0;
    let warnings = 0;

    for (const [selectorName, config] of Object.entries(selectors)) {
      const result = testSelector(selectorName, config);
      results.push(result);

      const riskIcon = result.risk === 'high' ? '🔴' : result.risk === 'medium' ? '🟡' : '🟢';

      console.log(`${result.status} ${riskIcon} ${result.name}`);
      console.log(`   Selector: ${result.selector.substring(0, 60)}${result.selector.length > 60 ? '...' : ''}`);
      console.log(`   Found: ${result.count} elements (expected: ${result.minExpected}+)`);
      console.log(`   Description: ${result.description}`);
      console.log('');

      if (result.passed) {
        passed++;
      } else if (result.required) {
        failed++;
      } else {
        warnings++;
      }
    }

    console.log(`${'─'.repeat(60)}`);
    console.log(`SUMMARY: ✅ ${passed} passed | ❌ ${failed} failed | ⚠️ ${warnings} warnings`);
    console.log(`${'─'.repeat(60)}\n`);

    return { results, passed, failed, warnings };
  }

  function testGroupsSelectors() {
    if (!window.location.href.includes('facebook.com/groups')) {
      console.warn('⚠️ Not on a Facebook Groups page. Navigate to a group members page for accurate results.');
    }
    return testSelectorGroup('FACEBOOK GROUPS', GROUPS_SELECTORS);
  }

  function testMessengerSelectors() {
    if (!window.location.href.includes('facebook.com/messages')) {
      console.warn('⚠️ Not on Messenger. Navigate to facebook.com/messages for accurate results.');
    }
    return testSelectorGroup('MESSENGER', MESSENGER_SELECTORS);
  }

  function testAllSelectors() {
    console.log('\n🔍 CRM EXTENSION SELECTOR TEST SUITE\n');
    console.log('Running comprehensive selector validation...\n');

    const groupsResults = testGroupsSelectors();
    const messengerResults = testMessengerSelectors();

    const totalPassed = groupsResults.passed + messengerResults.passed;
    const totalFailed = groupsResults.failed + messengerResults.failed;
    const totalWarnings = groupsResults.warnings + messengerResults.warnings;

    console.log('\n' + '═'.repeat(60));
    console.log('  FINAL SUMMARY');
    console.log('═'.repeat(60));
    console.log(`\n  ✅ Passed:   ${totalPassed}`);
    console.log(`  ❌ Failed:   ${totalFailed}`);
    console.log(`  ⚠️  Warnings: ${totalWarnings}`);
    console.log(`\n  Overall: ${totalFailed === 0 ? '✅ ALL CRITICAL SELECTORS WORKING' : '❌ SOME SELECTORS BROKEN'}\n`);

    // Return structured results for E2E tests
    return {
      groups: groupsResults,
      messenger: messengerResults,
      summary: {
        passed: totalPassed,
        failed: totalFailed,
        warnings: totalWarnings,
        allPassed: totalFailed === 0
      }
    };
  }

  // Generate report for broken selectors
  function getBrokenSelectors() {
    const allSelectors = { ...GROUPS_SELECTORS, ...MESSENGER_SELECTORS };
    const broken = [];

    for (const [name, config] of Object.entries(allSelectors)) {
      const count = document.querySelectorAll(config.selector).length;
      if (count < config.minExpected && config.required) {
        broken.push({
          name,
          selector: config.selector,
          description: config.description,
          expected: config.minExpected,
          found: count
        });
      }
    }

    return broken;
  }

  // Expose functions globally
  window.CRMSelectorTest = {
    testGroupsSelectors,
    testMessengerSelectors,
    testAllSelectors,
    getBrokenSelectors,
    GROUPS_SELECTORS,
    MESSENGER_SELECTORS
  };

  // Auto-run on load
  console.log('🔧 CRM Selector Test loaded. Available commands:');
  console.log('   • CRMSelectorTest.testGroupsSelectors()   - Test Groups page selectors');
  console.log('   • CRMSelectorTest.testMessengerSelectors() - Test Messenger selectors');
  console.log('   • CRMSelectorTest.testAllSelectors()       - Run all tests');
  console.log('   • CRMSelectorTest.getBrokenSelectors()     - Get list of broken selectors\n');

  // Run appropriate test based on current page
  if (window.location.href.includes('facebook.com/groups')) {
    console.log('📍 Detected Groups page - running Groups selector test...\n');
    testGroupsSelectors();
  } else if (window.location.href.includes('facebook.com/messages')) {
    console.log('📍 Detected Messenger - running Messenger selector test...\n');
    testMessengerSelectors();
  } else {
    console.log('📍 Unknown page - run testAllSelectors() manually or navigate to Facebook/Messenger\n');
  }

})();
