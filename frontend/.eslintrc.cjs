module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'node_modules', 'e2e'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    // Downgrade some strict rules to warnings for now
    'react-hooks/exhaustive-deps': 'warn',
    'react-hooks/rules-of-hooks': 'error',
    // Disable experimental rules that have many false positives
    // These rules are from react-hooks v5.x and are stricter
    'react-hooks/static-components': 'off',
    'react-hooks/set-state-in-effect': 'off',
    'react-hooks/immutability': 'off',
    'react-hooks/refs': 'off',
    'react-hooks/render-side-effects': 'off',
    'react-hooks/purity': 'off',
    // Allow empty catch blocks with comments
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
}
