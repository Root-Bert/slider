# PPTX fixture corpus

These pairs of decks (`v1.pptx` → `v2.pptx`) and their `expected.json` files remain available
for manual investigation of slide matching and parser behavior. They are no longer an
automated test suite. API sync tests cover preservation of slide identity and comments.

- `cases.ts`: declarative cases and paths.
- `bases.ts`: basis decks and producer transforms.
- `spec.ts`: labelled deck types and transforms.
- `run-case.ts`: parsing, fingerprinting, matching, and fixture generation.
- `decks/<id>/`: generated deck pairs and expected results.
- `real/<name>/`: optional real exported files.

To regenerate the declared fixtures from `packages/pptx`:

```sh
bun run corpus
```

Review generated differences manually; regenerating expected output does not verify that the
new behavior is correct. See [the test strategy](../../../../docs/testing.md) for CI coverage.
