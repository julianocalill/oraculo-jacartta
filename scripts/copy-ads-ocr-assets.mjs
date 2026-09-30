// Copia o worker, o núcleo WASM e o modelo de português para o mesmo domínio
// do Oráculo. O navegador processa a imagem localmente, sem CDN nem upload.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { mkdir, copyFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const web = resolve(import.meta.dirname, '../apps/web');
const tesseractRoot = dirname(require.resolve('tesseract.js/package.json', { paths: [web] }));
const coreRoot = dirname(require.resolve('tesseract.js-core/package.json', { paths: [tesseractRoot] }));
const languageRoot = dirname(require.resolve('@tesseract.js-data/por/package.json', { paths: [web] }));
const destination = join(web, 'public/ads-ocr');
await mkdir(join(destination, 'core'), { recursive: true });
await mkdir(join(destination, 'lang'), { recursive: true });

await copyFile(join(tesseractRoot, 'dist/worker.min.js'), join(destination, 'worker.min.js'));
for (const variant of ['lstm', 'simd-lstm', 'relaxedsimd-lstm']) {
  for (const suffix of ['wasm.js', 'wasm']) {
    const name = `tesseract-core-${variant}.${suffix}`;
    await copyFile(join(coreRoot, name), join(destination, 'core', name));
  }
}
await copyFile(join(languageRoot, '4.0.0/por.traineddata.gz'), join(destination, 'lang/por.traineddata.gz'));
console.log('Arquivos do OCR Shopee Ads preparados em apps/web/public/ads-ocr.');
