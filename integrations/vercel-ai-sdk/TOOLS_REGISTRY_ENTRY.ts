// Prepared entry for vercel/ai content/tools-registry/registry.ts (PR title: "feat(tools-registry): add botsrated").
// Submitted as vercel/ai#23894 (2026-10-23, from amcc8q; the PR uses isStepCount per registry convention). npm: @botsrated/ai-sdk; docs: https://botsrated.com/docs/ai-sdk
  {
    slug: 'botsrated',
    name: 'BotsRated',
    description:
      'Pre-payment check for x402 sellers. Free preflight returns the latest unpaid, signed probe of a seller (status, valid 402, latency, observed price and payTo) and flags a payTo never seen for that host. Optional check ($0.001 USDC on Base, first 100 per day free) with a user-set budget.',
    packageName: '@botsrated/ai-sdk',
    tags: ['payments', 'x402', 'trust'],
    installCommand: {
      pnpm: 'pnpm add @botsrated/ai-sdk',
      npm: 'npm install @botsrated/ai-sdk',
      yarn: 'yarn add @botsrated/ai-sdk',
      bun: 'bun add @botsrated/ai-sdk',
    },
    codeExample: `import { generateText, stepCountIs } from 'ai';
import { botsratedTools } from '@botsrated/ai-sdk';

const { text } = await generateText({
  model: 'openai/gpt-5-mini',
  prompt:
    'Before paying https://blockrun.ai/api/v1/chat/completions, check the seller with BotsRated.',
  tools: botsratedTools(),
  stopWhen: stepCountIs(3),
});

console.log(text);`,
    docsUrl: 'https://botsrated.com/docs/ai-sdk',
    websiteUrl: 'https://botsrated.com',
    npmUrl: 'https://www.npmjs.com/package/@botsrated/ai-sdk',
  },
