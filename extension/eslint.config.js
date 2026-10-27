const browserGlobals = {
  browser: "readonly",
  console: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  structuredClone: "readonly",
};

export default [
  { ignores: ["node_modules/**", "web-ext-artifacts/**"] },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: browserGlobals,
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      eqeqeq: ["error", "smart"],
    },
  },
  {
    files: ["content/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...browserGlobals, window: "readonly", document: "readonly" },
    },
  },
  {
    files: ["options/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: { ...browserGlobals, document: "readonly", window: "readonly", Blob: "readonly", NodeFilter: "readonly" },
    },
  },
];
