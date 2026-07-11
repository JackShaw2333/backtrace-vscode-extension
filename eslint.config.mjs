// @ts-check
import tseslint from 'typescript-eslint';
import eslint from '@eslint/js';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            'no-console': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'indent': 'off',
            '@typescript-eslint/indent': 'off',
        },
    },
    {
        ignores: ['out/**', 'node_modules/**', '**/*.js', '**/*.mjs', 'eslint.config.mjs'],
    },
);
