# Publishing elbebridge.com

Step by step, in order. Roughly 20 minutes of work plus up to 24 hours of DNS
propagation.

---

## 0. Pre-flight (2 minutes)

```bash
cd ~/Desktop/elbebridge/web
npm run clean
npm run build
npm run audit          # must print "104 passed, 0 failed"
```

If the audit fails, stop and fix it. It checks, among other things, that no
`[[PLACEHOLDER]]` reaches the HTML and that the Impressum carries your address,
phone and both names.

Optional but tidy — the preview screenshots are build artefacts, not source:

```bash
echo "web/preview-*.png" >> ~/Desktop/elbebridge/.gitignore
```

---

## 1. Create the repository

On GitHub: **New repository**.

- Name: `elbebridge`
- **Public** — GitHub Pages needs a paid plan for private repos
- Do **not** add a README, .gitignore or licence; the folder already has them

Copy the repo URL from the next screen.

---

## 2. Push

```bash
cd ~/Desktop/elbebridge
git init -b main
git add .
git commit -m "elbebridge: compliance scanner and website"
git remote add origin https://github.com/ethanbahmanyari0122/elbebridge.git
git push -u origin main
```

Check what you committed before the push if you like — `git status --short`.
`node_modules/`, `dist/`, `.astro/` and the scanner's `out/` are all ignored.

---

## 3. Turn on Pages

Repo → **Settings** → **Pages** → **Build and deployment** → **Source**.

The dropdown defaults to **Deploy from a branch**. Click it and choose
**GitHub Actions**. It applies immediately — there is no Save button for that
dropdown, and the "Branch" section below it disappears once changed.

The repository must be **public** for this on a Free plan. Private repos need
GitHub Pro or above.

Your push already triggered `.github/workflows/deploy.yml`, and it will have
failed at the deploy step because Pages was off. Go to the **Actions** tab,
open the failed run and click **Re-run all jobs**.

---

## 4. Add the custom domain — before touching DNS

Settings → **Pages** → **Custom domain** → type `elbebridge.com` → **Save**.

Order matters. GitHub's own guidance is to claim the domain on the repo first;
configuring DNS while the domain is unclaimed lets someone else host a site on
it.

> **`web/public/CNAME` does not do this job.** When you publish from a GitHub
> Actions workflow — which you are — GitHub ignores any `CNAME` file in the
> build. The setting above is what counts. The file is harmless and only matters
> if you ever switch to branch-based publishing.

---

## 5. DNS at GoDaddy

Go to the **DNS records table** for elbebridge.com and edit records by hand.

> **Do not use Connect Domain, Airo, or any GoDaddy wizard.** They rewrite the
> whole zone, and your Google Workspace MX, SPF, DKIM and DMARC records live in
> that same zone. You have lost DNS to a GoDaddy wizard once already. Touch only
> the rows below and change nothing else.

**First: delete GoDaddy's default parked record.** There will be an existing
`A` record on `@` pointing at a GoDaddy parking IP. Remove it, or the site will
intermittently resolve to a parking page.

**Then add these nine rows.** Nothing else in the zone changes.

| Type | Name | Value |
|---|---|---|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| AAAA | @ | 2606:50c0:8000::153 |
| AAAA | @ | 2606:50c0:8001::153 |
| AAAA | @ | 2606:50c0:8002::153 |
| AAAA | @ | 2606:50c0:8003::153 |
| CNAME | www | ethanbahmanyari0122.github.io |

The `www` CNAME points at `ethanbahmanyari0122.github.io` — your **account**, not
the repository. No `/elbebridge` on the end, and a trailing dot if GoDaddy wants
one.

With both apex and `www` configured, GitHub creates the redirect automatically:
`www.elbebridge.com` → `elbebridge.com`.

The AAAA records are optional but recommended; keep the A records regardless.

---

## 6. Check DNS resolved

```bash
dig elbebridge.com +noall +answer -t A
dig www.elbebridge.com +nostats +nocomments +nocmd
```

The first should return the four `185.199.*` addresses. The second should show a
CNAME to `ethanbahmanyari0122.github.io`. Propagation can take up to 24 hours —
usually far less.

---

## 7. Enforce HTTPS

Back in Settings → Pages, once DNS resolves, GitHub issues a Let's Encrypt
certificate. When the tick box becomes available, enable **Enforce HTTPS**.

It can take up to 24 hours to appear. If it is still greyed out after that,
remove the custom domain, save, re-add it and save again — that forces a fresh
certificate request.

---

## 8. Verify the domain against takeover

Settings → **Pages** → **Verified domains**, or your account settings →
**Pages**. GitHub gives you a `TXT` record to add at GoDaddy. Add it.

This stops anyone else pointing a GitHub repo at your domain. Five minutes, and
it matters more for you than for most — you are selling trust.

---

## 9. Check the live site

Once `https://elbebridge.com` loads:

- [ ] `https://www.elbebridge.com` redirects to the apex
- [ ] `/impressum`, `/privacy`, `/accessibility` all load
- [ ] The **Deutsch** link goes to `/de/`, and from there `/de/impressum`,
      `/de/datenschutz`, `/de/barrierefreiheit` load
- [ ] The "Email us your store URL" button opens your mail client with the
      subject prefilled
- [ ] `https://elbebridge.com/sitemap-index.xml` returns XML
- [ ] `https://elbebridge.com/robots.txt` returns the file

Then point your own scanner at it:

```bash
cd ~/Desktop/elbebridge/scanner
npm install
printf 'domain\nelbebridge.com\n' > own.csv
node src/index.js -i own.csv -o out --force
```

`out/elbebridge.com/scan.json` should come back with `axeTotal: 0`,
`hasA11yStatement: true`, `hasImpressum: true` and your legal entity extracted.
If your own tool cannot find your own Impressum, that is a scanner bug worth
knowing about before you send a report to a stranger.

---

## 10. Day-to-day

Every push to `main` rebuilds and redeploys, typically in about two minutes.

```bash
# edit web/src/content/copy/en.json and de.json
cd ~/Desktop/elbebridge/web
npm run build && npm run audit     # never push a failing audit
cd ..
git add -A && git commit -m "Update pricing" && git push
```

Watch the **Actions** tab for the run.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Actions run fails at "Install" | `npm ci` needs the lockfile to match `package.json`. Run `npm install` in `web/`, commit the updated `package-lock.json`. |
| Actions run fails at "Deploy" | Pages source is not set to GitHub Actions. Do step 3, then re-run the job. |
| 404 at elbebridge.com | Custom domain not saved in Settings → Pages, or DNS not propagated. Check step 4 before blaming DNS. |
| Site loads but CSS is missing | `site:` in `web/astro.config.mjs` no longer matches the live domain. |
| Parking page appears intermittently | GoDaddy's default `A` record still exists alongside the GitHub ones. Delete it. |
| Enforce HTTPS greyed out after 24h | Remove the custom domain, save, re-add, save. |
| Email suddenly broken | A GoDaddy wizard rewrote the zone. Check MX, SPF, DKIM and DMARC are still present. |
| `Cannot read properties of undefined` in dev | Stale content cache. Stop the dev server, then `npm run dev:clean`. |

---

## Not part of publishing, but do it this week

- **Add the USt-IdNr** to the Impressum when you are assigned one — § 5 DDG
  requires it where one exists.
- **Re-date** the privacy and accessibility statements whenever their content
  changes. Both currently read 15 August 2026.
- **Get legal eyes on the Impressum** before serious outreach. It states
  `elbebridge GbR` with both of you as representatives, and no register entry,
  on the basis that a GbR arises by operation of law and has no Handelsregister
  entry. That is the normal reading, but you are selling compliance and it is
  worth an hour of a lawyer's time.
- **Check the rules on cold email** (UWG § 7) before Ornella sends the first
  hundred. The exposure runs to the sender.
