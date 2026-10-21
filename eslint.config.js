import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
  },
  {
    // Browser script ships unbuilt, so it must stay within ES2017 syntax.
    files: ['public/js/**/*.js'],
    languageOptions: { ecmaVersion: 2017, sourceType: 'script', globals: globals.browser },
  },
];
