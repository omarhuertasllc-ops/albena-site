import { APPROVAL_POLICY } from './approval';
// Shared constants and schema.org builders. Nothing here is invented: every
// value comes from copy that is visible on the site.
export const SITE = 'https://albena.ai';
export const ORG_ID = `${SITE}/#organization`;
export const SITE_ID = `${SITE}/#website`;
export const SOFTWARE_ID = `${SITE}/#software`;
export const OG_IMAGE = `${SITE}/og.png`;
export const OG_IMAGE_ALT = 'Albena: private, local-first AI assistant for your home. Your AI. Your systems. Your approval.';
export const PREORDER = 'https://schema.org/PreOrder';

export const organization = {
  '@type': 'Organization',
  '@id': ORG_ID,
  name: 'Omar Huertas LLC',
  url: SITE,
  logo: { '@type': 'ImageObject', url: `${SITE}/logo.png`, width: 512, height: 512 },
  brand: { '@type': 'Brand', name: 'Albena' },
  sameAs: ['https://dbaomarhuertasllc.com'],
  contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: 'support@albena.ai', availableLanguage: 'English' },
};

export const website = {
  '@type': 'WebSite',
  '@id': SITE_ID,
  url: SITE,
  name: 'Albena',
  description: 'Albena is a private, local-first AI assistant for your home and life.',
  inLanguage: 'en',
  publisher: { '@id': ORG_ID },
};

export const preOrderOffer = (path: string) => ({
  '@type': 'Offer',
  url: `${SITE}${path}`,
  availability: PREORDER,
  seller: { '@id': ORG_ID },
});

export const software = {
  '@type': 'SoftwareApplication',
  '@id': SOFTWARE_ID,
  name: 'Albena',
  url: SITE,
  description:
    'Albena is a private, local-first AI assistant that runs on hardware you own, connects to your smart home, media, work and cloud systems, and asks before anything that matters.',
  applicationCategory: 'LifestyleApplication',
  applicationSubCategory: 'Home automation and personal AI assistant',
  operatingSystem: 'macOS, Linux',
  image: OG_IMAGE,
  featureList: [
    'Voice assistant with a custom wake phrase, processed on your own devices',
    'Runs local models on a Mac (Apple silicon) or NVIDIA RTX hardware, with optional cloud models only if you allow them',
    'Connectors for Home Assistant, Philips Hue, Slack, Google Workspace, Jira, GitHub, AWS and more, plus any REST API or MCP server',
    APPROVAL_POLICY,
    'Memory you can view, correct and delete',
  ],
  publisher: { '@id': ORG_ID },
  offers: preOrderOffer('/pricing'),
};

export const hubProduct = (kind: 'mac' | 'nvidia') => ({
  '@type': 'Product',
  '@id': `${SITE}/hardware#hub-${kind}`,
  name: kind === 'mac' ? 'Albena Hub for Mac' : 'Albena Hub for NVIDIA',
  description:
    kind === 'mac'
      ? 'A quiet, efficient Apple silicon Mac mini running Albena, with Apple on-device intelligence plus local models. Low power and near silent, suited to a household.'
      : 'An RTX GPU workstation or server-class machine running Albena, for larger local models, vision and camera AI, and multi-user households, estates and small businesses.',
  brand: { '@type': 'Brand', name: 'Albena' },
  manufacturer: { '@id': ORG_ID },
  category: 'Home AI assistant hardware',
  image: OG_IMAGE,
  url: `${SITE}/hardware`,
  offers: preOrderOffer('/pricing'),
});

export const faqPage = (items: { q: string; a: string }[], path: string) => ({
  '@type': 'FAQPage',
  '@id': `${SITE}${path}#faq`,
  url: `${SITE}${path}`,
  mainEntity: items.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
});

export const webPage = (path: string, name: string, description: string, type = 'WebPage') => ({
  '@type': type,
  '@id': `${SITE}${path === '/' ? '' : path}#webpage`,
  url: `${SITE}${path === '/' ? '/' : path}`,
  name,
  description,
  inLanguage: 'en',
  isPartOf: { '@id': SITE_ID },
  publisher: { '@id': ORG_ID },
});
