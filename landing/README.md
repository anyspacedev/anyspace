# AnySpace landing

Marketing site for AnySpace. Astro 5, zero-JS by default (small inline scripts only for OS detection, sticky-nav, billing toggle).

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

## Environment variables

The `/desktop/sign-in` route (browser-side bridge for the desktop app's
OAuth flow — see `src/components/islands/DesktopSignIn.tsx`) needs two
`PUBLIC_*` vars. They're Astro/Vite **build-time** inlines, not runtime,
so they must be present whenever `astro build` runs — local dev and CI.

| Var | Value |
|-----|-------|
| `PUBLIC_CLERK_PUBLISHABLE_KEY` | Same Clerk publishable key the desktop app uses (`VITE_CLERK_PUBLISHABLE_KEY` in `/.env`). |
| `PUBLIC_ANYSPACE_API_URL` | Base URL of the backend that mints sign-in tickets — `https://api.anyspace.dev` in production. |

Local dev: copy `.env.example` → `.env` and fill in the values. `.env`
is gitignored.

Cloudflare Pages: set both under **Pages → project → Settings →
Environment variables → Variables and Secrets**, **Production** scope
(and **Preview** if you use preview deploys). After adding, re-run the
last deployment from the dashboard — or push a new commit to trigger a
rebuild — so the values get baked into the bundle.

If either is missing at build time, the bridge page renders an inline
"Sign-in unavailable" notice instead of mounting Clerk; verify with:

```bash
curl -s https://anyspace.dev/_astro/DesktopSignIn.*.js | grep -o 'pk_live_[A-Za-z0-9_-]*'
```

(Expects a non-empty match.)

## Deploy

Output is fully static — drop `dist/` on any static host (Cloudflare Pages, Netlify, Vercel, S3+CloudFront, GitHub Pages).

## Replace placeholders

- `public/favicon.svg` — logo placeholder, swap in real brand mark
- `public/og.png` — **missing**, add a 1200×630 social-share image referenced from `Base.astro`
- Pricing prices and copy in `src/components/Pricing.astro`
- GitHub URL in `Nav.astro`, `Hero.astro`, `Footer.astro`
- Footer links (`/docs`, `/blog`, `/privacy`, etc.) — point at real routes when they exist
- `site` URL in `astro.config.mjs` — change `https://anyspace.dev` to the real domain so canonical/OG URLs render correctly


Design tokens live in `:root` in `global.css` — change once, the whole site re-themes.
