R28-only validation reminder:

- This repo keeps a small R28-focused validation script for route regression checks.
- The real runtime implementation remains in src/.
- Generic debug scripts were removed to keep the project clean.
- Use the main canonical route name as R28 in smoke tests; the Chinese alias 紅28 is supported by the worker but not required in scripting examples.
