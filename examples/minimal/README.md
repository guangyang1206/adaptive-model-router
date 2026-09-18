# minimal example

The smallest thing that proves the router works: install one package, run one
file, read a ranking. No API key, no TypeScript toolchain, no build step.

## Run it

```bash
npm install
node index.mjs
```

Output:

```
demo/large score=101.00
demo/small score=75.00
```

Two models are declared: one `standard` tier, one `high` tier. The request asks
for `quality: "high"`, so the high-tier model wins. Change `quality` to
`"standard"` and the ranking inverts — `demo/small` scores 105.00 and
`demo/large` 101.00.

`router.evaluate()` only scores the catalog — it never calls a provider — which
is why this runs offline with no credentials.

For provider adapters, fallback, cost estimation, trace persistence and the
dashboard, see [`../basic-agent`](../basic-agent).
