# Teamship landing

Marketing site for Teamship. Astro 5, zero-JS by default (small inline scripts only for OS detection, sticky-nav, billing toggle).

## Develop

```bash
cd landing
npm install
npm run dev      # http://localhost:4321
```

## Build

```bash
npm run build    # static output → dist/
npm run preview  # preview the production build locally
```

## Deploy

Output is fully static — drop `dist/` on any static host (Cloudflare Pages, Netlify, Vercel, S3+CloudFront, GitHub Pages).

## Replace placeholders

- `public/favicon.svg` — logo placeholder, swap in real brand mark
- `public/og.png` — **missing**, add a 1200×630 social-share image referenced from `Base.astro`
- Pricing prices and copy in `src/components/Pricing.astro`
- GitHub URL in `Nav.astro`, `Hero.astro`, `Footer.astro`
- Footer links (`/docs`, `/blog`, `/privacy`, etc.) — point at real routes when they exist
- `site` URL in `astro.config.mjs` — change `https://teamship.app` to the real domain so canonical/OG URLs render correctly

## Structure

```
src/
├── layouts/Base.astro        — <html>, meta, fonts, skip-link
├── pages/index.astro         — composes the sections in order
├── components/
│   ├── Nav.astro             — sticky, OS-aware
│   ├── Hero.astro            — value prop + CTAs + OS-detected download label
│   ├── TerminalMockup.astro  — CSS-only terminal showing OSC 133 blocks
│   ├── Features.astro        — six pillars
│   ├── HowItWorks.astro      — three-step flow
│   ├── Pricing.astro         — Free / Pro / Team with monthly/annual toggle
│   ├── FAQ.astro             — six items, native <details>
│   └── Footer.astro          — secondary nav + copyright
└── styles/global.css         — tokens, primitives (.btn, .card), reset, reduced-motion
```

Design tokens live in `:root` in `global.css` — change once, the whole site re-themes.
