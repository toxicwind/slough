## What

## Why

## Benchmarks (transfer-path changes only)

```
paste RESULTS.txt from ./bin/speed-race.sh
```

## Safety check (phone-side or classifier changes only)

- [ ] Photos still never auto-routed
- [ ] `clean` still requires verify + `--yes`
- [ ] New routing rules have unit tests in `tests/`

## Tests

- [ ] `bun test` green
- [ ] `shellcheck bin/*.sh` clean
