// Flat ESLint config for the adaptive-model-router monorepo.
//
// Goal: a pragmatic quality gate that catches real mistakes (unused vars,
// unsafe equality, accidental debugger/console noise) without drowning a small
// MVP codebase in stylistic churn. Type-aware linting is intentionally NOT
// enabled here to keep the gate fast and runnable in CI without a full
// project-graph type-check (the `tsc` build already provides type safety).

import js from "@eslint/js"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    // Never lint build output, deps, or coverage.
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/**/*.ts"],
    rules: {
      // Unused vars are real bugs — but allow intentional `_`-prefixed args.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The SDK/storage layers legitimately use `any` at trust boundaries
      // (dynamic node:sqlite loader, untyped provider payloads). Warn, not error.
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow `require`-style interop where the dynamic loaders need it.
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-console": "off", // CLI + dashboard legitimately log to stdout.
      eqeqeq: ["error", "smart"],
      "no-debugger": "error",
    },
  },
  {
    // Test files (.mjs) use the Node test runner — lint lightly.
    files: ["packages/**/test/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
)
