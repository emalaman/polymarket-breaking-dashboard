#!/usr/bin/env node

const fetch = require('node-fetch');
const crypto = require('crypto');

// Configuração (será preenchida pelas env vars do GitHub Actions)
const API_KEY = process.env.POLYMARKET_API_KEY;
const API_SECRET = process.env.POLYMARKET_API_SECRET;
const API_PASSPHRASE = process.env.POLYMARKET_API_PASSPHRASE;
const BASE_URL = 'https://clob.polymarket.com';

// Se não tiver credenciais, avisa
if (!API_KEY || !API_SECRET || !API_PASSPHRASE) {
  console.error('❌ Credenciais CLOB não encontradas. Configure POLYMARKET_API_KEY, POLYMARKET_API_SECRET, POLYMARKET_API_PASSPHRASE');
  process.exit(1);
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
      if (b.isBreaking !== a.isBreaking) return b.isBreaking - a.isBreaking;
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
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
