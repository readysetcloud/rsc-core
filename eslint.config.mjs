import pluginJs from "@eslint/js";

export default [
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        Buffer: 'readonly',
        TextEncoder: 'readonly',
        URL: 'readonly'
      }
    }
  },
  { ignores: ['.aws-sam/*', 'ui/dist/*', 'ui/node_modules/*', 'ui/tailwind-preset.cjs', 'agent/dist/*', 'agent/node_modules/*', 'agent-runtime/dist/*', 'agent-runtime/node_modules/*', 'agent-runtime/.artifact/*', 'links/dist/*', 'links/node_modules/*'] },
  pluginJs.configs.recommended
];
