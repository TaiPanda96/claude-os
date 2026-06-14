// @ts-check

/**
 * Prettier configuration for the Claude OS monorepo.
 *
 * Why an ESM `.mjs` config: the repo is `"type": "module"`, and the JSDoc
 * `@type` annotation gives editor autocomplete + typechecking on the options
 * without pulling Prettier into the TS build. Most values below are Prettier 3
 * defaults stated explicitly so the house style is self-documenting rather than
 * implied.
 *
 * @type {import("prettier").Config}
 */
const config = {
  // Match the existing codebase: double quotes, semicolons, 2-space indent.
  semi: true,
  singleQuote: false,
  tabWidth: 2,
  useTabs: false,

  // Wider than the 80-col default — existing source comments routinely exceed it.
  printWidth: 100,

  // Prettier 3 defaults, pinned for clarity.
  trailingComma: "all",
  bracketSpacing: true,
  arrowParens: "always",
  endOfLine: "lf",

  // Keep relative-import `.js` extensions and other quoted props untouched.
  quoteProps: "as-needed",
};

export default config;
