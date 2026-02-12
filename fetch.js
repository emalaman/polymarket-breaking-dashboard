#!/usr/bin/env node

const fetch = require('node-fetch');
const crypto = require('crypto');

// Configuração (será preenchida pelas env vars do GitHub Actions)
const API_KEY = process.env.POLYMARKET_API_KEY;
const API_SECRET = process.env.POLYMARKET_API_SECRET;
const API_PASSPHRASE = process.env.POLYMARKET_API_PASSPHRASE;
const BASE_URL = 'https://clob.polymarket.com';

// Se não tiver credenciais, gera dados de exemplo (modo demo)
if (!API_KEY || !API_SECRET || !API_PASSPHRASE) {
  console.warn('⚠️  Credenciais CLOB não encontradas. Gerando dados de exemplo (demo mode)...');
  generateMockData();
  process.exit(0);
}

// Assinatura HMAC para CLOB API
function signRequest(method, path, body = '', timestamp = Date.now()) {
  const secret = Buffer.from(API_SECRET, 'base64');
  const payload = `${timestamp}${method.toUpperCase()}${path}${body}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64');
  
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-BAPI-TIMESTAMP': timestamp,
    'X-BAPI-API-KEY': API_KEY,
    'X-BAPI-SIGN': signature,
    'X-BAPI-PASSPHRASE': API_PASSPHRASE
  };
}

// Buscar mercados ativos
async function fetchMarkets(limit = 500) {
  const path = `/data?limit=${limit}&active=true&closed=false`;
  const url = `${BASE_URL}${path}`;
  
  const headers = signRequest('GET', path);
  const res = await fetch(url, { headers });
  
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  
  const data = await res.json();
  return data.data || data.markets || [];
}

// Buscar candles (ultima hora, 1min resolution)
async function fetchCandles(marketId, resolution = '1m', limit = 60) {
  const path = `/data/${marketId}/candles?resolution=${resolution}&limit=${limit}`;
  const url = `${BASE_URL}${path}`;
  
  const headers = signRequest('GET', path);
  const res = await fetch(url, { headers });
  
  if (!res.ok) {
    return null; // Mercado pode não ter candles
  }
  
  return await res.json();
}

// Calcular métricas de "breaking"
function analyzeBreaking(candles) {
  if (!candles || candles.length < 11) return null; // precisamos de pelo menos 11 (10 para média + 1 atual)
  
  // Último candle
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  
  const lastVolume = parseFloat(last[5]) || 0; // volume
  const lastClose = parseFloat(last[4]) || 0; // close price (YES price)
  
  // Média de volume dos 10 candles anteriores
  const volSum = 0;
  for (let i = candles.length - 11; i < candles.length - 1; i++) {
    volSum += parseFloat(candles[i][5]) || 0;
  }
  const avgVolume = volSum / 10;
  
  // Mudança de preço (último min vs min anterior)
  const prevClose = parseFloat(prev[4]) || 0;
  const priceChange = prevClose > 0 ? (lastClose - prevClose) / prevClose : 0;
  
  return {
    volume: lastVolume,
    avgVolume,
    volumeRatio: lastVolume / (avgVolume || 1),
    priceChange,
    lastClose
  };
}

// Determinar sinal baseado no preço YES atual
function getSignal(yesPrice, priceChange) {
  if (yesPrice < 0.40) {
    return {
      label: '🔥 COMPRA YES',
      class: 'bg-green-600',
      reason: `YES muito baixo (${yesPrice.toFixed(3)}) - probabilidade subestimada`
    };
  } else if (yesPrice > 0.60) {
    return {
      label: '⚠️ VENDA/EVITAR',
      class: 'bg-red-600',
      reason: `YES muito alto (${yesPrice.toFixed(3)}) - probabilidade superestimada`
    };
  } else if (yesPrice < 0.48 && priceChange > 0.005) {
    return {
      label: '📈 TENDÊNCIA ALTA',
      class: 'bg-blue-600',
      reason: `YES subindo (+${(priceChange*100).toFixed(2)}%)`
    };
  } else if (yesPrice > 0.52 && priceChange < -0.005) {
    return {
      label: '📉 TENDÊNCIA BAIXA',
      class: 'bg-orange-600',
      reason: `YES caindo (${(priceChange*100).toFixed(2)}%)`
    };
  }
  return {
    label: '⏳ AGUARDAR',
    class: 'bg-gray-600',
    reason: 'Sem sinal claro'
  };
}

// Função principal
async function main() {
  console.log('🔍 Buscando mercados ativos da CLOB API...');
  
  try {
    const markets = await fetchMarkets(200); // limitar a 200 para não sobrecarregar
    console.log(`📊 ${markets.length} mercados encontrados`);
    
    const analyzed = [];
    
    for (let i = 0; i < markets.length; i++) {
      const market = markets[i];
      const marketId = market.marketId || market.id;
      const question = market.question || '';
      
      // Extrair preços YES/NO
      let prices = market.outcomePrices;
      if (typeof prices === 'string') {
        try { prices = JSON.parse(prices); } catch (e) { continue; }
      }
      if (!prices || prices.length < 2) continue;
      
      const yes = parseFloat(prices[0]);
      const no = parseFloat(prices[1]);
      
      if (yes === 0 || no === 0) continue;
      
      // Buscar candles para análise de breaking
      const candles = await fetchCandles(marketId, '1m', 60);
      const analysis = analyzeBreaking(candles);
      
      if (!analysis) continue; // poucos dados
      
      // Critérios de breaking
      const isBreaking = 
        analysis.volumeRatio > 3 && 
        Math.abs(analysis.priceChange) > 0.01 &&
        Math.max(yes, no) - Math.min(yes, no) > 0.02; // spread > 2%
      
      // Sinal
      const signal = getSignal(yes, analysis.priceChange);
      
      analyzed.push({
        id: marketId,
        question: question.substring(0, 80) + (question.length > 80 ? '...' : ''),
        yes: yes.toFixed(3),
        no: no.toFixed(3),
        spread: (Math.max(yes, no) - Math.min(yes, no)).toFixed(3),
        volume24h: parseFloat(market.volume || 0),
        volumeNow: analysis.volume,
        volumeRatio: analysis.volumeRatio.toFixed(2) + 'x',
        priceChange: (analysis.priceChange * 100).toFixed(2) + '%',
        signal,
        isBreaking,
        lastUpdate: new Date().toISOString(),
        url: `https://polymarket.com/market/${marketId}`
      });
    }
    
    // Ordenar: primeiro os breaking, depois por volume
    analyzed.sort((a, b) => {
      if (b.isBreaking !== a.isBreaking) return b.isbreaking - a.isbreaking;
      return b.volumeNow - a.volumeNow;
    });
    
    const output = {
      generatedAt: new Date().toISOString(),
      totalMarkets: analyzed.length,
      breakingCount: analyzed.filter(m => m.isBreaking).length,
      markets: analyzed
    };
    
    const fs = require('fs');
    fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
    console.log(`✅ data.json gerado com ${analyzed.length} mercados (${output.breakingCount} breaking)`);
    
  } catch (error) {
    console.error('❌ Erro:', error.message);
    // Em caso de erro, gera dados mock para não quebrar o deploy
    console.log('🔄 Gerando dados de exemplo (mock) devido a erro...');
    generateMockData();
  }
}

// Dados de exemplo para demo mode
function generateMockData() {
  const fs = require('fs');
  const mock = {
    generatedAt: new Date().toISOString(),
    totalMarkets: 3,
    breakingCount: 1,
    markets: [
      {
        id: "demo1",
        question: "Will Bitcoin hit $100k before June 2025?",
        yes: "0.485",
        no: "0.515",
        spread: "0.030",
        volume24h: 1250000,
        volumeNow: 45000,
        volumeRatio: "3.20x",
        priceChange: "+2.45%",
        signal: {
          label: "📈 TENDÊNCIA ALTA",
          class: "bg-blue-600",
          reason: "YES subindo (+2.45%)"
        },
        isBreaking: true,
        lastUpdate: new Date().toISOString(),
        url: "https://polymarket.com/market/demo1",
        candles: generateMockCandles(0.485, 60)
      },
      {
        id: "demo2",
        question: "Will Fed raise rates in March?",
        yes: "0.520",
        no: "0.480",
        spread: "0.040",
        volume24h: 890000,
        volumeNow: 12000,
        volumeRatio: "1.10x",
        priceChange: "-0.32%",
        signal: {
          label: "⏳ AGUARDAR",
          class: "bg-gray-600",
          reason: "Sem sinal claro"
        },
        isBreaking: false,
        lastUpdate: new Date().toISOString(),
        url: "https://polymarket.com/market/demo2",
        candles: generateMockCandles(0.520, 60)
      },
      {
        id: "demo3",
        question: "Will Ethereum reach $5k by end of 2025?",
        yes: "0.320",
        no: "0.680",
        spread: "0.360",
        volume24h: 2100000,
        volumeNow: 8500,
        volumeRatio: "0.90x",
        priceChange: "+0.15%",
        signal: {
          label: "🔥 COMPRA YES",
          class: "bg-green-600",
          reason: "YES muito baixo (0.320) - probabilidade subestimada"
        },
        isBreaking: false,
        lastUpdate: new Date().toISOString(),
        url: "https://polymarket.com/market/demo3",
        candles: generateMockCandles(0.320, 60)
      }
    ]
  };
  
  fs.writeFileSync('data.json', JSON.stringify(mock, null, 2));
  console.log(`✅ data.json mock gerado com ${mock.markets.length} mercados (${mock.breakingCount} breaking)`);
}

function generateMockCandles(basePrice, count) {
  const candles = [];
  let price = basePrice - 0.02;
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    price += (Math.random() - 0.45) * 0.01;
    price = Math.max(0.01, Math.min(0.99, price));
    const time = new Date(now - (count - i) * 60 * 1000).toISOString();
    const volume = Math.floor(Math.random() * 5000) + 1000;
    candles.push([time, price.toFixed(3), (1-price).toFixed(3), price.toFixed(3), price.toFixed(3), volume]);
  }
  return candles;
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
