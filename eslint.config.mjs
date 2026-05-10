import nx from '@nx/eslint-plugin';
import prettier from 'eslint-config-prettier';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
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
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
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
              onlyDependOnLibsWithTags: ['type:feature', 'type:data-access']
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
            }
          ]
        }
      ]
    }
  },
  prettier
];
