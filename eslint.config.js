import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import json from "@eslint/json";
import importPlugin from "eslint-plugin-import";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.next/**",
      "**/.wrangler/**",
      ".turbo/**",
      "**/next-env.d.ts",
      "**/sdk_shared_core_wasm_bindings.js",
      "**/*.mjs",
      "**/test/**",
      "**/api-extractor.json",
      "**/src/generated/**",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...js.configs.recommended,
    languageOptions: {
      globals: globals.node,
    },
  },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx,mts,cts}"],
  })),
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-empty-object-type": [
        "error",
        { allowInterfaces: "always" },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNever: true,
          allowArray: true,
        },
      ],
      "no-console": "error",
    },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    plugins: {
      import: importPlugin,
    },
    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        },
      },
    },
    rules: {
      "import/order": [
        "off",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
          ],
          "newlines-between": "never",
          alphabetize: { order: "asc" },
        },
      ],
    },
  },
  {
    files: [
      "./packages/examples/**/*.ts",
      "./packages/tests/restate-e2e-services/**/*.ts",
      "./packages/libs/restate-sdk-testcontainers/**/*.ts",
    ],
    rules: {
      "no-console": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "import/order": "off",
    },
  },
  {
    files: ["**/*.config.{js,ts,mjs,mts}"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["**/*.json"],
    ignores: ["package-lock.json"],
    language: "json/json",
    ...json.configs.recommended,
  },
  {
    files: ["**/tsconfig*.json", ".vscode/*.json"],
    language: "json/jsonc",
    ...json.configs.recommended,
  },
];
