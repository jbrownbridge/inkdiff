import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results', 'artifacts', '.auth'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
