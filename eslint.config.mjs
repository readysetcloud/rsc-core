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
        Buffer: 'readonly',
        TextEncoder: 'readonly'
      }
    }
  },
  { ignores: ['.aws-sam/*', 'ui/dist/*', 'ui/node_modules/*', 'ui/tailwind-preset.cjs'] },
  pluginJs.configs.recommended
];
