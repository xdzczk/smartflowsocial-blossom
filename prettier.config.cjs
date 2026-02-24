/**
 * Prettier Configuration - aligned with main app (no Tailwind plugin)
 *
 * @type {import("prettier").Config}
 */
module.exports = {
  semi: true,
  singleQuote: false,
  tabWidth: 2,
  useTabs: false,
  trailingComma: "es5",
  printWidth: 80,
  arrowParens: "always",
  endOfLine: "lf",
  bracketSpacing: true,
  bracketSameLine: false,
  quoteProps: "as-needed",
  overrides: [
    {
      files: "*.md",
      options: {
        printWidth: 100,
        proseWrap: "always",
      },
    },
    {
      files: "*.json",
      options: {
        printWidth: 100,
        tabWidth: 2,
      },
    },
    {
      files: "*.{yml,yaml}",
      options: {
        tabWidth: 2,
        singleQuote: false,
      },
    },
    {
      files: ["package.json", "pnpm-lock.yaml"],
      options: {
        printWidth: 1000,
      },
    },
  ],
};
