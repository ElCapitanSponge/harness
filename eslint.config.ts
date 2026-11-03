import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Strict by design: every rule is an error or off, never a warning. The standards are in docs/specs/web-experience-v2.md (section 8).
export default defineConfig(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/storybook-static/**", "bench-results/**", "deploy/**"] },

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  stylistic.configs.customize({ indent: 2, quotes: "double", semi: true, commaDangle: "always-multiline", braceStyle: "1tbs", arrowParens: true }),

  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // No var, no any.
      "no-var": "error",
      "prefer-const": "error",
      "@typescript-eslint/no-explicit-any": "error",

      // Arrow functions only. The things that cannot be arrows are class methods, constructors, accessors and generators.
      "func-style": ["error", "expression"],
      "prefer-arrow-callback": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "VariableDeclarator > FunctionExpression[generator=false], AssignmentExpression > FunctionExpression[generator=false], Property[method=false][kind='init'] > FunctionExpression[generator=false]",
          message: "Use an arrow function: () => { ... }",
        },
      ],

      // Braces, always: arrow functions have a block body and every control statement has braces.
      "arrow-body-style": ["error", "always"],
      "curly": ["error", "all"],

      // No alert, confirm or prompt: a question for the person is a ConfirmDialog, which can be styled and tested.
      "no-alert": "error",

      "@typescript-eslint/consistent-type-imports": "error",

      // Printing a number in a message is safe; the strict default would make every count and port a String() call.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],

      // One statement per line, so braces are real blocks and not one-line shells.
      "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: false }],

      // Formatting is checked by ESLint Stylistic, not a separate formatter, and long lines are the author's call.
      "@stylistic/max-len": "off",
    },
  },

  {
    // The web app: browser code, with the React rules (hooks and the React Compiler's checks) as errors.
    files: ["packages/web/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat["recommended-latest"]],
    languageOptions: { globals: globals.browser },
    rules: {
      // JSX reads better with short elements on one line; these rules would split every label and icon button.
      "@stylistic/jsx-one-expression-per-line": "off",
      "@stylistic/jsx-first-prop-new-line": "off",
      "@stylistic/jsx-max-props-per-line": "off",
      "@stylistic/multiline-ternary": "off",
    },
  },

  {
    // Tests index into arrays they have just filled, and fake async interfaces with functions that have nothing to await.
    // Both are routine there and noise elsewhere, so the two rules are off for test files only.
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
);
