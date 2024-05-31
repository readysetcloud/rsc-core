import pluginJs from "@eslint/js";

export default [
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly'
      }
    }
  },
  { ignores: ['.aws-sam/*'] },
  pluginJs.configs.recommended
];
