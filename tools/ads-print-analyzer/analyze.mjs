// O protótipo macOS usa a mesma regra da aplicação web, sem duplicar cenários.
import { readFileSync } from 'node:fs';
import { adsPrintAnalyze } from '../../packages/domain/ads-print.js';

const request = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(adsPrintAnalyze(request.data, request.today)));
