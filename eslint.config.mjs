import nx from '@nx/eslint-plugin';
import vue from 'eslint-plugin-vue';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  ...vue.configs['flat/recommended'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/.nx',
      '**/.DS_Store',
      '**/__MACOSX/**',
      '**/vite.config.*.timestamp*'
    ]
  },
  {
    // Vue SFCs are only otherwise-affected by the shared flat/typescript preset via
    // their <script> block's content — vue-eslint-parser delegates that block to
    // this parser, so the same TS-aware rules below (no-unused-vars, module
    // boundaries) run against it too, same as any .ts file.
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tsParser }
    }
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.vue'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'error',
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: ['type:feature', 'type:data-access', 'type:utils']
            },
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: ['type:ui', 'type:data-access', 'type:utils']
            },
            {
              sourceTag: 'type:data-access',
              onlyDependOnLibsWithTags: ['type:utils']
            },
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: ['type:utils']
            },
            {
              sourceTag: 'type:utils',
              onlyDependOnLibsWithTags: ['type:utils']
            },
            {
              sourceTag: 'framework:angular',
              onlyDependOnLibsWithTags: ['framework:angular', 'framework:shared']
            },
            {
              sourceTag: 'framework:react',
              onlyDependOnLibsWithTags: ['framework:react', 'framework:shared']
            },
            {
              sourceTag: 'framework:vue',
              onlyDependOnLibsWithTags: ['framework:vue', 'framework:shared']
            },
            {
              sourceTag: 'framework:shared',
              onlyDependOnLibsWithTags: ['framework:shared']
            }
          ]
        }
      ]
    }
  },
  prettier
];
