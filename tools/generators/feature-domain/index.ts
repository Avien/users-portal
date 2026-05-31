import { Tree, formatFiles, generateFiles, joinPathFragments, updateJson } from '@nx/devkit';
import { GeneratorsUtils } from '../generators.utils';
import type { FeatureDomainSchema } from './schema.d';

export async function featureDomainGenerator(tree: Tree, schema: FeatureDomainSchema) {
  const name = schema.name; // kebab-case, e.g. "products"

  const helpers = {
    capitalcase: GeneratorsUtils.capitalcase,
    camelcase: GeneratorsUtils.camelcase,
    uppercase: GeneratorsUtils.uppercase,
    tpl: '',
    name,
  };

  // 1. Shared utils lib → libs/<name>/
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files/shared'),
    `libs/${name}`,
    helpers,
  );

  // 2. Angular data-access lib → libs/<name>-angular/data-access/
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files/angular'),
    `libs/${name}-angular/data-access`,
    helpers,
  );

  // 3. React data-access lib → libs/<name>-react/data-access/
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files/react-data-access'),
    `libs/${name}-react/data-access`,
    helpers,
  );

  // 4. React feature lib → libs/<name>-react/feature/
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files/react-feature'),
    `libs/${name}-react/feature`,
    helpers,
  );

  // 5. Register path aliases in tsconfig.base.json
  updateJson(tree, 'tsconfig.base.json', (json) => {
    const paths = json.compilerOptions.paths ?? {};
    paths[`@portal/${name}/utils`] = [`libs/${name}/src/index.ts`];
    paths[`@portal/${name}-angular/data-access`] = [`libs/${name}-angular/data-access/src/index.ts`];
    paths[`@portal/${name}-react/data-access`] = [`libs/${name}-react/data-access/src/index.ts`];
    paths[`@portal/${name}-react/feature`] = [`libs/${name}-react/feature/src/index.ts`];
    json.compilerOptions.paths = paths;
    return json;
  });

  return formatFiles(tree);
}

export default featureDomainGenerator;