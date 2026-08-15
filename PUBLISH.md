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

