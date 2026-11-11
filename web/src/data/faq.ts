import { APPROVAL_POLICY } from './approval';
// Single source for the /faq page, its FAQPage schema and llms-full.txt.
// Answer-first: the first sentence answers the question. Facts only; every
// claim here is also stated on the product pages it links to.
export interface Faq { q: string; a: string; more?: [label: string, href: string] }
export interface FaqGroup { id: string; title: string; items: Faq[] }

export const faqGroups: FaqGroup[] = [
  {
    id: 'basics',
    title: 'The basics',
    items: [
      { q: 'What is Albena?', a: 'Albena is a private, local-first AI assistant for your home and life, built by Omar Huertas LLC. You say “Hey Albena” and she can help with your home, calendar, mail, media and work tools. She runs on hardware you own, uses local models first, and asks before anything that matters.', more: ['See what she does', '/features'] },
      { q: 'What is a private home AI assistant?', a: 'A private home AI assistant is an assistant that handles your requests on equipment in your home instead of sending everything to a provider’s servers. Albena is built this way: everyday requests, audio, device data and memory are processed on hardware you own wherever possible, and a cloud model is used only if a task needs it and you allow it.', more: ['How it works', '/how-it-works'] },
      { q: 'What does local-first mean for Albena?', a: 'Local-first means Albena tries to handle each request on your own hardware before anything else. She uses local models and, on a Mac, Apple on-device intelligence. That keeps requests fast and private, and everyday requests keep working when the internet is down.', more: ['How it works', '/how-it-works'] },
      { q: 'Is Albena available now?', a: 'Albena is in early access and is not yet generally available. We invite people from the waitlist in small groups and email waitlist members before anything changes for them. There is no fixed public launch date yet.', more: ['Join the waitlist', '/waitlist'] },
      { q: 'Who makes Albena?', a: 'Albena is made by Omar Huertas LLC, a small team. You can reach the team at support@albena.ai or through the support page.', more: ['Support', '/support'] },
    ],
  },
  {
    id: 'hardware',
    title: 'Running Albena on your own hardware',
    items: [
      { q: 'Can Albena run locally on a Mac?', a: 'Yes. Albena runs on Apple silicon Macs, using Apple on-device intelligence alongside local models. You can install her on a Mac you already own with the Bring Your Own license, or choose Albena Hub for Mac, a Mac mini with Albena preinstalled.', more: ['Albena Hub for Mac', '/hardware'] },
      { q: 'Can I self-host an AI assistant on NVIDIA hardware with Albena?', a: 'Yes. Albena supports an NVIDIA Linux machine with an RTX GPU, which can run larger local models and camera and vision AI. Choose Albena Hub for NVIDIA, or install Albena yourself on an NVIDIA Linux box you already have.', more: ['Albena Hub for NVIDIA', '/hardware'] },
      { q: 'Which should I choose, Hub for Mac or Hub for NVIDIA?', a: 'Choose Hub for Mac for a quiet, low-power, always-on assistant for a household, and Hub for NVIDIA for larger local models, always-on camera and vision AI, and many users or rooms. We describe the differences qualitatively and will publish tested figures at launch, not before.', more: ['Compare the Hubs', '/hardware'] },
      { q: 'Do I need to buy hardware from you?', a: 'No. Bring Your Own installs Albena on a Mac (Apple silicon) or NVIDIA Linux machine you already own. Hub editions are for people who want hardware with Albena preinstalled and a setup that takes about 10 minutes.', more: ['Plans', '/pricing'] },
      { q: 'Does Albena need an internet connection?', a: 'No for everyday requests, which run locally. Some connectors, such as email or cloud services, need a connection to reach their own systems, and an optional cloud model needs one if you allow it.', more: ['Privacy and data', '/privacy'] },
    ],
  },
  {
    id: 'home',
    title: 'Smart home and connectors',
    items: [
      { q: 'Can Albena control Home Assistant?', a: 'Yes. Home Assistant is one of Albena’s connectors, for devices and scenes. Albena also connects to Philips Hue, WiZ, Google Nest thermostats, LG and other smart TVs, and cameras, and the same approval policy applies: ' + APPROVAL_POLICY, more: ['All connectors', '/connectors'] },
      { q: 'How is Albena different from Home Assistant Assist?', a: 'Home Assistant Assist is an excellent local voice interface focused on Home Assistant, while Albena is a broader assistant that treats Home Assistant as one connector among many. Albena also covers calendars, mail, collaboration tools, media libraries, cloud and IT systems and personal memory under one approval and audit model. Choose Assist if your goal is an open, local voice interface for Home Assistant.', more: ['Compare Albena with alternatives', '/compare'] },
      { q: 'What can Albena connect to besides the smart home?', a: 'Albena connects to media (Jellyfin, Navidrome, Immich, YouTube), work tools (Google Workspace, Microsoft Teams, Slack, Jira, ServiceNow, GitHub, LinkedIn, Meta pages) and cloud and IT systems (AWS, Azure, Cloudflare, VMware, Docker, Kubernetes, Tailscale, AdGuard, Active Directory and LDAP).', more: ['Connector catalog', '/connectors'] },
      { q: 'Can I connect my own tools to Albena?', a: 'Yes. You can add any REST API or MCP server as your own connector. Connected tools follow the same rules as built-in ones: the same approval policy applies: ' + APPROVAL_POLICY, more: ['Connectors', '/connectors'] },
    ],
  },
  {
    id: 'control',
    title: 'Approvals, memory and privacy',
    items: [
      { q: 'Does Albena ask before taking actions?', a: 'Yes. ' + APPROVAL_POLICY + ' Approval applies to the specific action in front of you, not to future changes.', more: ['Approval architecture', '/how-it-works'] },
      { q: 'What extra protection do risky actions get?', a: 'The highest-risk actions need your PIN and a change record, and Albena saves rollback information and writes everything to an audit log. The log records what was asked, what was approved and what was done.', more: ['Controls and evidence', '/trust/controls'] },
      { q: 'Can I see and delete what Albena remembers?', a: 'Yes. Albena remembers your people, routines and preferences so you do not repeat yourself, and every memory can be viewed, corrected or deleted, one item or all of it. Memory is stored on your hardware first.', more: ['Privacy policy', '/privacy'] },
      { q: 'Does Albena sell my data or use it for advertising?', a: 'No. We never sell your data and never use conversations for advertising. The albena.ai marketing website sets no cookies of its own and runs no analytics or advertising trackers; the customer portal uses only strictly necessary session cookies.', more: ['Privacy policy', '/privacy'] },
      { q: 'When does Albena use a cloud AI model?', a: 'Only when a task needs a larger model and you allow it. Cloud models are off by default, Albena tells you when she reaches for one, and when allowed they are billed at cost.', more: ['How it works', '/how-it-works'] },
    ],
  },
  {
    id: 'compare',
    title: 'Comparing Albena with other assistants',
    items: [
      { q: 'Is Albena a privacy-focused alternative to Alexa?', a: 'Albena is designed as a private, local-first alternative to cloud voice assistants, although it does not replace every Alexa skill or device. Most mainstream voice assistants are provider-hosted, while Albena runs on hardware you own and sends nothing to a cloud model unless you allow it. Alexa has deep native ecosystem reach that Albena does not try to copy.', more: ['Albena vs other assistants', '/compare'] },
      { q: 'How is Albena different from ChatGPT, Claude or Gemini?', a: 'ChatGPT, Claude and Gemini are cloud assistants with powerful models, whereas Albena is an owner-controlled assistant that runs on your hardware and connects to your home and work systems. When you permit it, a cloud model can be one of the tools Albena uses. The difference is who controls the operating layer: your approvals, memory and audit log.', more: ['Albena vs other assistants', '/compare'] },
    ],
  },
  {
    id: 'plans',
    title: 'Pricing, estates and trust',
    items: [
      { q: 'How much does Albena cost?', a: 'We have not published prices yet. Early access pricing will be announced, and reserving an edition costs nothing and commits you to nothing. We email waitlist members before anything becomes final.', more: ['Plans', '/pricing'] },
      { q: 'Can Albena run an estate or a small business?', a: 'Yes, that is what the NVIDIA Hub and the Pro / Estate install are for. The NVIDIA edition is built for multi-user households, estates and small businesses, and the Pro / Estate install covers a site survey, installation, connector setup and tuning for your property or business. Albena supports per-user permission tiers.', more: ['Pro / Estate install', '/pricing'] },
      { q: 'Is Albena SOC 2 or otherwise certified?', a: 'No. Albena holds no security certifications today, and independent audits have not yet been completed. Our practices are aligned with frameworks such as SOC 2 and NIST 800-53, and we publish a control mapping with honest status for each control.', more: ['Trust center', '/trust'] },
    ],
  },
];

export const allFaqs: Faq[] = faqGroups.flatMap((g) => g.items);
