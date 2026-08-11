import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "worker-configuration.d.ts"] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // Security baseline: no dynamic code evaluation anywhere in this codebase.
    // The entry keypad's inline arithmetic is a hand-written token evaluator (src/lib/calc.ts)
    // precisely so that this rule can stay on.
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },

  {
    // The UI. Spacing, colour and elevation come from the token scales via the primitives in
    // src/ui — never from a number written at the call site.
    files: ["src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: 'JSXAttribute[name.name="style"]',
          message:
            "Inline styles bypass the token scales. Use Stack/Cluster/Spread with a `gap`, a " +
            "Button variant, or a class. Genuinely dynamic values (a drag offset, a measured " +
            "width) are fine — disable this line and say which.",
        },
      ],
    },
  },

  {
    files: ["worker/**/*.ts"],
    languageOptions: { globals: {} },
    rules: {
      // Never log request bodies, headers, or token-shaped values from the Worker.
      "no-restricted-properties": [
        "error",
        {
          object: "console",
          property: "debug",
          message: "Use no logging in the Worker beyond error message + code.",
        },
      ],
    },
  },

  {
    // Build tooling and one-off maintenance scripts, which legitimately run in Node.
    files: ["vite.config.ts", "eslint.config.js", "vitest.config.ts", "scripts/**/*.{js,mjs,ts}"],
    languageOptions: { globals: globals.node },
  },
);
