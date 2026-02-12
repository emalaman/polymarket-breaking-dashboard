#!/usr/bin/env node

const fs = require('fs');

const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
const markets = data.markets || [];

console.log(`Gerando dashboard com ${markets.length} mercados (${data.breakingCount} breaking)`);

let html = fs.readFileSync('index.html', 'utf8');
html = html.replace('%TOTAL_MARKETS%', data.totalMarkets || markets.length);
html = html.replace('%BREAKING_COUNT%', data.breakingCount || 0);
html = html.replace('%GENERATED_AT%', new Date().toLocaleString('pt-BR'));
html = html.replace('%MARKETS_JSON%', JSON.stringify(markets));

fs.writeFileSync('index.html', html);
console.log('✅ index.html gerado');
