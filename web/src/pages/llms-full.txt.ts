import type { APIRoute } from 'astro';
import { faqGroups } from '../data/faq';
import { categories } from '../data/connectors';

const abs = (h: string) => `https://albena.ai${h}`;

export const GET: APIRoute = () => {
  const faq = faqGroups
    .map((g) => `### ${g.title}\n\n` + g.items.map((f) => `**${f.q}**\n${f.a}${f.more ? ` (${abs(f.more[1])})` : ''}`).join('\n\n'))
    .join('\n\n');
  const connectors = categories.map((c) => `- ${c.label}: ${c.items.map((i) => i.name).join(', ')}`).join('\n');
  const body = `# Albena: full reference

> Albena is a private, local-first AI assistant for your home and life, made by Omar Huertas LLC. Early access; not yet generally available. Canonical site: https://albena.ai. Short index: https://albena.ai/llms.txt

## What Albena is

Albena is a voice-first AI assistant ("Hey Albena") that runs on hardware you own: a Mac with Apple silicon, or an NVIDIA RTX Linux machine. Everyday requests are handled by local models (and Apple on-device intelligence on a Mac). A cloud model is used only if a task needs it and you allow it, and Albena tells you when she reaches for one. Every change is proposed to the owner first; high-risk changes also need a change record and a PIN, and are recorded in an audit log with rollback information. Memory of people, routines and preferences is stored on the owner's hardware first and can be viewed, corrected and deleted.

## Editions (early access, pricing not announced)

- Albena Hub for Mac: Apple silicon Mac mini with Albena preinstalled. Low power, near silent, suited to a household. ${abs('/hardware')}
- Albena Hub for NVIDIA: RTX GPU workstation or server-class machine for larger local models, camera and vision AI, multi-user households, estates and small businesses. ${abs('/hardware')}
- Bring Your Own: software license to install Albena on a Mac (Apple silicon) or NVIDIA Linux machine you already own.
- Pro / Estate install: site survey, installation, connector setup and tuning. ${abs('/pricing')}

## Connectors

${connectors}
- Your systems: any REST API or MCP server

Details: ${abs('/connectors')}

## Trust status

No security certification is claimed. Practices are aligned with SOC 2 Trust Services Criteria, NIST 800-53, STIG/CIS and NIST CSF 2.0 and are mapped, with honest status, at ${abs('/trust/controls')}. Independent audits have not yet been completed. The marketing website sets no cookies of its own and runs no analytics or advertising trackers; the customer portal uses only strictly necessary session cookies.

## Frequently asked questions

${faq}

## Comparisons

Albena vs cloud assistants (ChatGPT, Claude, Gemini, Copilot) and Home Assistant Assist, with sources and a last-verified date: ${abs('/compare')}

## Contact

support@albena.ai, or ${abs('/support')}
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
