# Email and DNS — verified 15 August 2026

Checked against public DNS (Google's resolver, answers served by GoDaddy's own
nameservers, so these are authoritative).

## Both domains — verified working

| | elbebridge.com | elbebridge.de |
|---|---|---|
| Google verification | Live | Live |
| MX (five Google hosts) | Live | Live |
| SPF | Live, chain resolves | Live, chain resolves |
| DKIM published | Live | Live, own key |
| DKIM **signing** | Authenticating | Authenticating |
| DMARC | `p=none`, `rua=ornella@elbebridge.com` | `p=none`, `rua=ornella@elbebridge.com` |

The two DMARC records now agree and both point at a mailbox that exists. The
`.com` DKIM key was compared byte-for-byte before and after the `.de` key was
generated, and is unchanged.

`hallo@elbebridge.com` exists as a Google Group with both of you as members.

## The four things still worth doing

**1. Confirm the group accepts external mail.** The group's access type shows as
*Custom*. The setting that matters is **Who can post → Anyone on the web**. The
default is members-only, which silently rejects every prospect who emails you —
they get nothing, and neither do you. Groups → elbebridge → Access settings.

**2. Test it end to end.** From an address outside the domain (a personal
Gmail), send to `hallo@elbebridge.com` and confirm it reaches both of you. Do
the same for `hallo@elbebridge.de`, which should arrive via the alias. Until
this test passes, the address on your live website is unproven.

**3. Ornella's send-as default.** Gmail → Settings → Accounts → *Send mail as* →
the `.de` address should be marked **(default)** if you want replies to go out
from the German domain.

**4. postmaster.google.com.** Add both domains. Each needs its own TXT record.
This is where you will see delivery and spam-rate data once outreach starts —
worth having in place before the first hundred emails, not after.

## Fragility to remember

Both SPF records use GoDaddy's indirect form: the record on `@` points at a
second record (`dc-aa8e722993._spfm`) which then includes Google. All four
records resolve today. If anyone deletes one of those second records thinking it
is GoDaddy clutter, that domain's mail stops authenticating.

## What to do, in order
## What to do, in order

*The steps below are kept as a record of what was done, and as the runbook if
you ever add a third domain.*

### 1. ~~Decide whether you need the .de~~ — done

### 2. ~~Add the domain in Google Workspace~~ — done, as a user alias domain

Admin console → **Account** → **Domains** → **Manage domains** → **Add a domain**
→ choose **Domain alias of elbebridge.com** → enter `elbebridge.de`.

Google gives you a TXT verification record. Add it at GoDaddy, then click
verify. An alias means every `@elbebridge.com` mailbox also receives at
`@elbebridge.de` with no extra licence cost.

### 3. Add the DNS at GoDaddy — `elbebridge.de` → Manage DNS

Add, in this order:

| Type | Name | Value | Priority |
|---|---|---|---|
| MX | @ | `aspmx.l.google.com` | 1 |
| MX | @ | `alt1.aspmx.l.google.com` | 5 |
| MX | @ | `alt2.aspmx.l.google.com` | 5 |
| MX | @ | `alt3.aspmx.l.google.com` | 10 |
| MX | @ | `alt4.aspmx.l.google.com` | 10 |
| TXT | @ | `v=spf1 include:_spf.google.com ~all` | — |

Then **edit** the existing `_dmarc` record rather than adding another — two
DMARC records on one name is the same as none:

```
v=DMARC1; p=none; rua=mailto:ornellas@elbebridge.com
```

Start at `p=none` to match the .com and to see reports before enforcing.

### 4. DKIM for the .de

Admin console → **Apps** → **Google Workspace** → **Gmail** → **Authenticate
email** → switch the domain dropdown to **elbebridge.de** → **Generate new
record** → publish the TXT at GoDaddy → **Start authentication**.

The dropdown is the step people miss: generating without switching regenerates
the .com key and invalidates the record already in DNS.

> Do not click **Generate New Record** while the dropdown shows elbebridge.com.
> That is the mistake your plan explicitly warned about, and the .com DKIM
> above is live and working.

### 5. Things I cannot check from outside — verify in the account

| Item | Where |
|---|---|
| Ornella's "send mail as" default | Gmail → Settings → Accounts → *Send mail as* → the .de address should say **(default)** |
| Both domains at postmaster.google.com | postmaster.google.com → Add both `elbebridge.com` and `elbebridge.de`; each needs its own TXT |
| Whether .de is really an alias | Admin → Account → Domains — it should be listed as an alias, not a secondary domain |

A secondary domain is not the same as an alias: a secondary domain needs its own
user accounts and licences, an alias does not. If it was added as secondary,
remove and re-add.

---

## Shared reply visibility — decided: a Google Group

Admin console → **Directory** → **Groups** → **Create group**.

| Field | Value |
|---|---|
| Name | elbebridge |
| Group email | `hallo@elbebridge.com` |
| Members | both of you, as **Owner** and **Manager** |
| Who can post | **Anyone on the web** — prospects are external, so this must not be members-only |
| Who can view conversations | Group members |

Two settings people miss:

- **Anyone on the web can post.** The default is members-only, which silently
  rejects every prospect who emails you.
- Turn on **conversation history** so the group keeps a shared archive rather
  than only fanning out copies.

The alias domain means `hallo@elbebridge.de` will also reach the group with no
extra setup.

**Test it before Monday:** send a message from an outside address to
`hallo@elbebridge.com` and confirm it arrives for both of you.

---

## Summary

- **.com email: verified working end to end.**
- **.de email: not configured. No MX, no SPF, no DKIM, and a GoDaddy DMARC
  record that is stricter than your real one.**
- Four items need someone inside the Google Workspace account to confirm.
- One decision outstanding: shared reply visibility.
