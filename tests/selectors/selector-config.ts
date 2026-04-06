// Default Facebook group URL for testing. Override with FACEBOOK_GROUP_URL env var.
export const FACEBOOK_GROUP_URL = 'https://www.facebook.com/groups/3005490419690915/members';

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

export interface SelectorDef {
  /** CSS selector string */
  selector: string;
  /** Human-readable description */
  description: string;
  /** How likely this selector is to break */
  risk: RiskLevel;
  /** true = hard fail if 0 matches; false = warning only */
  required: boolean;
  /** Selector only appears inside an open conversation */
  requiresNavigation?: boolean;
}

// ---------------------------------------------------------------------------
// Messenger selectors (facebook.com/messages)
// ---------------------------------------------------------------------------
export const MESSENGER_SELECTORS: Record<string, SelectorDef> = {
  CHATS_TITLE: {
    selector:
      'span.x1lliihq.x1plvlek.xryxfnj.x1n2onr6.xyejjpt.x15dsfln.x193iq5w.xeuugli.x13faqbe.x1vvkbs.x1s928wv.xhkezso.x1gmr53x.x1cpjm7i.x1fgarty.x1943h6x.x1xmvt09.xngnso2.x1xlr1w8.xw2npq5.x14z4hjw.x3x7a5m.xq9mrsl[dir="auto"]',
    description: 'Chats title header (auto-generated classes)',
    risk: 'critical',
    required: false,
  },
  HEADER_RIGHT_CONTROLS: {
    selector: 'div.x78zum5.x1q0g3np.x1diwwjn',
    description: 'Header right-side controls area (auto-generated classes)',
    risk: 'critical',
    required: false,
  },
  COMPOSER_ACTIONS: {
    selector: 'div.x6s0dn4.xpvyfi4.x78zum5.xl56j7k.x162z183',
    description: 'Message composer action buttons (auto-generated classes)',
    risk: 'critical',
    required: false,
  },
  CONVERSATION_LINK: {
    selector: 'a[href*="/t/"]:not([href*="/t/user"]):not([href*="/t/group"])',
    description: 'Chat conversation tiles in sidebar',
    risk: 'high',
    required: true,
  },
  CONVERSATION_NAME: {
    selector: 'span[dir="auto"] span',
    description: 'Conversation display name in sidebar',
    risk: 'medium',
    required: true,
  },
  CHATS_TITLE_FALLBACK: {
    selector: 'span[dir="auto"]',
    description: 'Fallback for chats title (broad match)',
    risk: 'low',
    required: true,
  },
  MESSAGE_INPUT: {
    selector: 'div[contenteditable="true"][role="textbox"]',
    description: 'Message text input box',
    risk: 'low',
    required: false,
    requiresNavigation: true,
  },
  MESSAGE_INPUT_FALLBACK_1: {
    selector: 'div[contenteditable="true"]:not([role="button"])',
    description: 'Message input fallback (contenteditable)',
    risk: 'low',
    required: false,
    requiresNavigation: true,
  },
  MESSAGE_INPUT_FALLBACK_2: {
    selector: '[data-testid="message-input"]',
    description: 'Message input fallback (data-testid)',
    risk: 'low',
    required: false,
    requiresNavigation: true,
  },
  MESSAGE_INPUT_FALLBACK_3: {
    selector: '.notranslate[contenteditable="true"]',
    description: 'Message input fallback (notranslate)',
    risk: 'low',
    required: false,
    requiresNavigation: true,
  },
  CHAT_CONTAINER: {
    selector: '[role="main"]',
    description: 'Main chat container',
    risk: 'low',
    required: true,
  },
  PROFILE_IMG: {
    selector: 'img[src*="scontent"]',
    description: 'Profile images (scontent CDN)',
    risk: 'low',
    required: true,
  },
  PROFILE_IMG_FBCDN: {
    selector: 'img[src*="fbcdn"]',
    description: 'Profile images (fbcdn CDN)',
    risk: 'low',
    required: false,
  },
  PROFILE_IMG_DATA_SCONTENT: {
    selector: 'img[data-src*="scontent"]',
    description: 'Profile images lazy-load (data-src scontent)',
    risk: 'low',
    required: false,
  },
  PROFILE_IMG_DATA_FBCDN: {
    selector: 'img[data-src*="fbcdn"]',
    description: 'Profile images lazy-load (data-src fbcdn)',
    risk: 'low',
    required: false,
  },
  PROFILE_IMG_REFERRER: {
    selector: 'img[referrerpolicy="origin-when-cross-origin"]',
    description: 'Profile images (referrerpolicy attribute)',
    risk: 'low',
    required: false,
  },
  PROFILE_BG_IMAGE: {
    selector: 'div[style*="background-image"]',
    description: 'Profile background images (inline style)',
    risk: 'low',
    required: false,
  },
  CONVERSATION_HEADER_H1: {
    selector: 'h1[dir="auto"]',
    description: 'Conversation header (h1)',
    risk: 'low',
    required: false,
    requiresNavigation: true,
  },
  CONVERSATION_HEADER_H2: {
    selector: 'h2[dir="auto"]',
    description: 'Conversation header (h2)',
    risk: 'low',
    required: false,
    requiresNavigation: true,
  },
  MESSAGE_PARAGRAPH: {
    selector: 'p.xat24cr.xdj266r',
    description: 'Message text paragraphs (auto-generated classes)',
    risk: 'medium',
    required: false,
    requiresNavigation: true,
  },
};

// ---------------------------------------------------------------------------
// Groups selectors (facebook.com/groups)
// ---------------------------------------------------------------------------
export const GROUPS_SELECTORS: Record<string, SelectorDef> = {
  MEMBER_ROW: {
    selector: 'div[role="listitem"][data-visualcompletion="ignore-dynamic"]',
    description: 'Group member list rows',
    risk: 'high',
    required: true,
  },
  GROUP_PROFILE_LINK: {
    selector: 'a[href*="/groups/"][href*="/user/"]',
    description: 'Member profile link within groups',
    risk: 'high',
    required: true,
  },
  ADD_FRIEND_BTN: {
    selector:
      '[aria-label*="Add Friend"], [aria-label*="Add friend"], [aria-label*="add friend"], [aria-label*="ADD FRIEND"]',
    description: 'Add Friend button (aria-label variants)',
    risk: 'medium',
    required: false,
  },
  ROLE_BUTTON: {
    selector: 'div[role="button"]',
    description: 'Generic role="button" elements (div only)',
    risk: 'low',
    required: false,
  },
  ROLE_BUTTON_ANY: {
    selector: '[role="button"]',
    description: 'Any element with role="button"',
    risk: 'low',
    required: false,
  },
  SVG_ARIA_LABEL: {
    selector: 'svg[aria-label]',
    description: 'SVG elements with aria-label (icons)',
    risk: 'low',
    required: false,
  },
  IMG_IMAGE_ELEMENTS: {
    selector: 'img, image',
    description: 'All img and image elements',
    risk: 'low',
    required: false,
  },
};
