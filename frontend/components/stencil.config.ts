import { Config } from '@stencil/core';
import { resolve } from 'node:path';

const fontFiles = ['core', 'sport', 'shapes'];
const fonts = (destination: string) => fontFiles.map(name => ({
  src: resolve(`node_modules/@tabler/icons-webfont/dist/fonts/tabler-icons.${name}.woff2`),
  dest: resolve(destination, `tabler-icons.${name}.woff2`),
}));

export const config: Config = {
  namespace: 'habitloop',
  globalStyle: 'src/styles/global.css',
  enableCache: false,
  outputTargets: [
    { type: 'dist', collectionDir: null, esmLoaderPath: '../loader', copy: fonts('dist/habitloop/fonts') },
    { type: 'dist-custom-elements', customElementsExportBehavior: 'auto-define-custom-elements' },
    { type: 'www', serviceWorker: null, baseUrl: '/', copy: [
      ...fonts('www/build/fonts'),
      { src: resolve('src/styles/demo.css'), dest: resolve('www/demo.css') },
    ] },
  ],
  testing: {
    testPathIgnorePatterns: ['/node_modules/', '/dist/', '/www/'],
  },
};
