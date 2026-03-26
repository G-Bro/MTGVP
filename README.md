# MTGVP Deployment Guide

This repo has two deploy targets:
- `mtgg-server/` -> Cloudflare Workers (signaling backend)
- `mtgg-client/` -> GitHub Pages (static frontend)

## 1) Deploy the server (Cloudflare Worker)

### Prerequisites
- Cloudflare account
- Wrangler CLI (already in `mtgg-server/package.json`)

### Commands (PowerShell)

```powershell
Set-Location mtgg-server
npm install

# Log in once
npx wrangler login

# Create KV namespace and copy the returned IDs
npx wrangler kv:namespace create ROOMS
npx wrangler kv:namespace create ROOMS --preview
```

Update `mtgg-server/wrangler.toml` with the namespace IDs from the commands above:
- `id = "..."`
- `preview_id = "..."`

Then deploy:

```powershell
Set-Location mtgg-server
npm run deploy
```

After deploy, copy your Worker URL (example: `https://mtgg-server.<subdomain>.workers.dev`).

## 2) Deploy the client (GitHub Pages)

The workflow file is already set at `.github/workflows/deploy.yml`.
It sets `VITE_BASE` dynamically to `/${{ github.event.repository.name }}/` so asset paths match the GitHub Pages repo URL.

### Required GitHub Secret
In your GitHub repo settings, add this secret:
- `VITE_WORKER_URL` = your deployed Worker URL, including protocol
	- Example: `https://mtgvp.georgehbroadhurst.workers.dev`

### Commands (PowerShell)

```powershell
Set-Location mtgg-client
npm install
npm run build
```

Then commit and push to `main` to trigger Pages deploy:

```powershell
Set-Location ..
git add .
git commit -m "Add deploy docs and app scaffolding"
git push origin main
```

The workflow will build `mtgg-client` and publish `mtgg-client/dist` to `gh-pages`.

## 3) First-time run checklist

- Worker deployed and responding
- `VITE_WORKER_URL` GitHub secret set
- GitHub Pages enabled (source: `gh-pages` branch if prompted)
- Frontend loads and can create/join rooms
test
