# Splitting the repository

The website has to be public so GitHub Pages can serve it on the free plan. The
scanner and the report generator are the business, and should not be.

The plan below **does not touch DNS, the custom domain, or GitHub Pages**. The
repository already wired to elbebridge.com stays exactly where it is and simply
loses the folders that should not be public. The tooling moves to a new private
repository.

Roughly twenty minutes.

---

## After the split

| Repository | Visibility | Contains |
|---|---|---|
| `elbebridge` (the one you have) | **public** | `web/`, `.github/workflows/deploy.yml`, `PUBLISH.md` |
| `elbebridge-ops` (new) | **private** | `scanner/`, `report/`, `docs/`, `STATUS.md`, `WORKFLOW.md`, `EMAIL-SETUP.md` |

Nothing about the deploy changes: the workflow still builds `web/` from the same
repository, so Pages, the certificate and the DNS records are all untouched.

---

## 1. Commit what you have now

Do this first, so the split starts from a clean state.

```bash
cd ~/Desktop/elbebridge
git rm --cached web/preview-*.png
git add -A
git commit -m "Report generator, intake tool, and Ornella's website review"
git push
```

## 2. Copy the tooling out, before deleting anything

```bash
cd ~/Desktop
mkdir elbebridge-ops
cp -R elbebridge/scanner elbebridge/report elbebridge/docs elbebridge-ops/
cp elbebridge/STATUS.md elbebridge/WORKFLOW.md elbebridge/EMAIL-SETUP.md elbebridge-ops/
cp elbebridge/.gitignore elbebridge-ops/.gitignore
```

Check it looks right before going further:

```bash
ls elbebridge-ops
# docs  report  scanner  EMAIL-SETUP.md  STATUS.md  WORKFLOW.md
```

## 3. Make the private repository

On GitHub: **New repository** → `elbebridge-ops` → **Private** → no README.

```bash
cd ~/Desktop/elbebridge-ops
git init -b main
git add -A
git commit -m "Scanner, report generator and operations documentation"
git remote add origin https://github.com/ethanbahmanyari0122/elbebridge-ops.git
git push -u origin main
```

Confirm on GitHub that it says **Private** before continuing.

## 4. Only then, remove them from the public repository

```bash
cd ~/Desktop/elbebridge
git rm -r --cached scanner report docs
rm -rf scanner report docs
git rm --cached STATUS.md WORKFLOW.md EMAIL-SETUP.md
rm STATUS.md WORKFLOW.md EMAIL-SETUP.md
git commit -m "Move scanner, report generator and operations docs to a private repository"
git push
```

Then check the live site still loads and the Actions run is green.

> **What this does not do.** The folders remain in the public repository's
> *history* — anyone can still read them at the old commits. For a marketing
> site and a scanner this is a nuisance rather than a breach, and nothing
> sensitive was ever committed: the scan output, the tracker and the register
> results were ignored from the start. If you would rather the history were
> clean too, the honest fix is to delete the public repository and push `web/`
> as a fresh one — which means re-adding the custom domain in Settings → Pages,
> and nothing else.

---

## Working in two repositories

**Day to day nothing changes.** The website is edited in `~/Desktop/elbebridge`,
the tooling in `~/Desktop/elbebridge-ops`. They do not need each other.

One thing that used to link them: `web/audit.cjs` borrowed Playwright from
`../scanner/node_modules`. It now looks in its own `node_modules` first and falls
back to the scanner's, so it works in either layout. Once the website stands
alone, run `npm install` in `web/` once and it will fetch its own copy.

`report/` and `docs/` still borrow Playwright from `../scanner/node_modules`, and
they stay siblings inside the ops repository, so nothing there changes.

---

## Why the website repository can safely stay public

It contains the site source, which is served publicly anyway, and nothing else.
No keys, no client data, no findings. What was worth protecting was the method —
how the check works, what it looks for, and who you have contacted — and all of
that is now private.
