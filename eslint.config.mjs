import pluginJs from "@eslint/js";
import globals from "globals";

export default [
  {
    // Design-system guide scripts run in the browser
    files: ['design-system/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: globals.browser
    }
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
        TextEncoder: 'readonly',
        URL: 'readonly'
      }
    }
  },
  { ignores: ['.aws-sam/*', 'ui/dist/*', 'ui/node_modules/*', 'ui/tailwind-preset.cjs', 'agent/dist/*', 'agent/node_modules/*', 'agent-runtime/dist/*', 'agent-runtime/node_modules/*', 'agent-runtime/.artifact/*'] },
  pluginJs.configs.recommended
];
