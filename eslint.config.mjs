/**
 * ESLint v9 Flat Config - Node/TypeScript only (no React)
 * Aligned with main app rule tiers where applicable.
 */

import js from "@eslint/js";
import tseslintPlugin from "@typescript-eslint/eslint-plugin";
import tseslintParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";
import promise from "eslint-plugin-promise";
import noSecrets from "eslint-plugin-no-secrets";
import prettier from "eslint-config-prettier";
import globals from "globals";

const tier1Rules = {
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/await-thenable": "error",
  "@typescript-eslint/no-misused-promises": "error",
  "@typescript-eslint/no-unnecessary-type-assertion": "error",
  "@typescript-eslint/consistent-type-assertions": [
    "error",
    { assertionStyle: "as", objectLiteralTypeAssertions: "allow" },
  ],
  "@typescript-eslint/restrict-template-expressions": [
    "error",
    {
      allowNumber: true,
      allowBoolean: true,
      allowAny: false,
      allowNullish: false,
    },
  ],
};

const tier2Rules = {
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      args: "after-used",
      ignoreRestSiblings: true,
    },
  ],
  "no-unused-vars": "off",
  "@typescript-eslint/consistent-type-imports": [
    "error",
    { prefer: "type-imports", fixStyle: "separate-type-imports" },
  ],
  "@typescript-eslint/prefer-nullish-coalescing": "warn",
  "@typescript-eslint/prefer-optional-chain": "warn",
  "@typescript-eslint/no-inferrable-types": "warn",
};

const importOrderRule = [
  "error",
  {
    alphabetize: { caseInsensitive: true, order: "asc" },
    groups: ["builtin", "external", "internal", "parent", "sibling"],
    "newlines-between": "always",
  },
];

const featureBoundaryRestrictions = [
  {
    target: "src/routes/**/*",
    from: "src/routes/**/*",
    message: "Route handlers should not depend on other route handlers.",
  },
  {
    target: "src/services/**/*",
    from: "src/routes/**/*",
    message: "Services must not import route modules.",
  },
  {
    target: "src/utils/**/*",
    from: "src/routes/**/*",
    message: "Utils must remain route-agnostic.",
  },
  {
    target: "src/utils/**/*",
    from: "src/services/**/*",
    message: "Utils must remain service-agnostic and side-effect free.",
  },
];

const qualityRules = {
  "promise/always-return": "warn",
  "promise/catch-or-return": "warn",
  "promise/no-nesting": "warn",
  "promise/no-return-in-finally": "error",
  "promise/prefer-await-to-then": "warn",
  "no-secrets/no-secrets": [
    "warn",
    {
      tolerance: 4.2,
      ignoreContent: [
        "^[a-f0-9]{32,64}$",
        "^[A-Za-z0-9+/=]{20,}$",
        "^[A-Za-z]{26,}$",
      ],
    },
  ],
};

export default [
  js.configs.recommended,
  {
    ignores: [
      "**/node_modules/**",
      "build/**",
      "dist/**",
      "static/**",
      "**/*.config.*",
      "coverage/**",
      "declarations.d.ts",
      "index.ts",
      "types.ts",
    ],
  },
  {
    files: ["src/**/*.ts"],
    plugins: {
      "@typescript-eslint": tseslintPlugin,
      import: importPlugin,
      promise,
      "no-secrets": noSecrets,
    },
    languageOptions: {
      parser: tseslintParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
        isolatedModules: true,
      },
      globals: { ...globals.node },
    },
    settings: {
      "import/resolver": {
        node: { extensions: [".ts"] },
        typescript: { alwaysTryTypes: true },
      },
    },
    rules: {
      ...tier1Rules,
      ...tier2Rules,
      "import/order": importOrderRule,
      "import/no-restricted-paths": [
        "error",
        { zones: featureBoundaryRestrictions },
      ],
      "no-console": ["error", { allow: ["error", "warn", "info"] }],
      ...qualityRules,
    },
  },
  {
    files: ["tests/**/*.ts", "**/*.test.ts", "**/*.spec.ts"],
    plugins: {
      "@typescript-eslint": tseslintPlugin,
      import: importPlugin,
      promise,
    },
    languageOptions: {
      parser: tseslintParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
        isolatedModules: true,
      },
      globals: { ...globals.node },
    },
    rules: {
      ...tier1Rules,
      ...tier2Rules,
      "import/order": "warn",
      "no-console": "off",
    },
  },
  prettier,
];
