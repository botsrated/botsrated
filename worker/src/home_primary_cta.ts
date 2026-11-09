// One primary next action on the home hero.
// Live tip 77ad7284 (2026-11-09) paints Attach Guard free and Open Desk
// as the same outline button. The headline ends on "One desk.", the top
// strip's only action is Desk, and the next section says "Start with Desk."
// Open Desk becomes the filled button. Attach Guard free stays a real
// second button. Get change alerts stays quiet.
//
// Not the later bot-vs-human redesign, and not a DeskGuard rename.
// Mount on the private page only when this returns replaced: true.
// Do not deploy from this file.

export const LIVE_HERO_CTA_HTML =
  '<div class="hh-cta"><a class="btn" href="/tools/payment-guard">Attach Guard free</a><a class="btn" href="/desk">Open Desk</a><a class="btn quiet" href="/desk/alerts">Get change alerts</a></div>';

export const PRIMARY_CTA_CSS_MARK = "home-primary-next-action";

export const PRIMARY_CTA_CSS = `
/* ${PRIMARY_CTA_CSS_MARK}: one filled control. Guard stays a second button. */
.hh-cta a.btn.btn-primary{background:var(--bw-fg);color:var(--bw-bg);border:1px solid var(--bw-fg)}
.hh-cta a.btn.btn-primary:hover,.hh-cta a.btn.btn-primary:active{background:var(--bw-muted);color:var(--bw-bg);border-color:var(--bw-muted)}
.hh-cta a.btn.btn-secondary{background:transparent;color:var(--bw-fg);border:1px solid var(--bw-fg)}
@media (max-width:720px){
  .hh-cta{flex-direction:column;align-items:stretch}
  .hh-cta a.btn{width:100%;justify-content:center}
}
`;

export function homeHeroCtaHtml(): string {
  return '<div class="hh-cta" data-primary="desk"><a class="btn btn-primary" href="/desk">Open Desk</a><a class="btn btn-secondary" href="/tools/payment-guard">Attach Guard free</a><a class="btn quiet" href="/desk/alerts">Get change alerts</a></div>';
}

export function mountHomePrimaryCta(documentHtml: string): { html: string; replaced: boolean; already: boolean } {
  const next = homeHeroCtaHtml();
  if (documentHtml.includes(next) && documentHtml.includes(PRIMARY_CTA_CSS_MARK)) {
    return { html: documentHtml, replaced: true, already: true };
  }
  if (!documentHtml.includes(LIVE_HERO_CTA_HTML)) return { html: documentHtml, replaced: false, already: false };
  let html = documentHtml.replaceAll(LIVE_HERO_CTA_HTML, next);
  if (html.includes("</style>")) html = html.replace("</style>", `${PRIMARY_CTA_CSS}</style>`);
  else html = `${PRIMARY_CTA_CSS}${html}`;
  return { html, replaced: true, already: false };
}
