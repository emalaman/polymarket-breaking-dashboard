# Polymarket Breaking Events Dashboard

Análise em tempo real de eventos "breaking" no Polymarket com sinais de trading.

**Funcionamento:**
1. Busca mercados ativos via CLOB API
2. Identifica eventos "breaking" (alta volatilidade + volume spike)
3. Analisa spread e tendência
4. Gera dashboard com sinais
5. Deploy automático no GitHub Pages

---

## 🚀 Quick Start

### 1. Configurar Secrets no GitHub

No repositório, vá em **Settings → Secrets and variables → Actions** e adicione:

- `POLYMARKET_API_KEY` - sua API Key
- `POLYMARKET_API_SECRET` - seu Secret
- `POLYMARKET_API_PASSPHRASE` - sua Passphrase

### 2. Deploy Automático

O GitHub Actions roda a cada **2 minutos**:
- Coleta dados da CLOB API
- Filtra eventos breaking
- Gera `index.html`
- Deploy no Pages

### 3. Acesse o Dashboard

Após primeiro deploy:
`https://SEUUSER.github.io/polymarket-breaking-dashboard/`

---

## 📊 Estratégia

### Como identifica "Breaking" events?

1. **Volume Spike**: volume último minuto > 3x a média dos últimos 10min
2. **Preço Change**: mudança > 1% no último minuto
3. **Spread Amplitude**: spread atual > 2%

Sinal de trading:

- **🟢 COMPRAR YES** se: 
  - YES < 0.48 E está subindo rápido
- **🔴 COMPRAR NO** se:
  - NO < 0.48 E está subindo rápido
- **⚠️ AGUARDAR** se:
  - Spread muito estreito (< 1%) ou volume baixo

---

## 🛠️ Tech Stack

- **Backend**: Node.js (CLOB API via `polymarket-js` ou fetch manual)
- **Frontend**: HTML estático + Tailwind + Chart.js
- **Deploy**: GitHub Actions + GitHub Pages
- **Secrets**: GitHub Actions Secrets

---

## 📁 Estrutura

```
├── fetch.js          # Busca mercados, detecta breaking, calcula sinais
├── generate.js       # Gera HTML
├── index.html        # Template
├── .github/workflows/deploy.yml
├── package.json
└── README.md
```

---

## 🔐 Sobre as Credenciais

- As chaves são usadas apenas no **GitHub Actions** (ambiente de CI)
- Nunca expostas no código-fonte
- Apenas leitura (`read:markets`) - seguro

---

## ⚙️ Customização

Ajuste thresholds em `fetch.js`:

```javascript
const VOLUME_SPIKE_MULTIPLIER = 3;    // volume último min > 3x média
const PRICE_CHANGE_THRESHOLD = 0.01;  // 1% de mudança no último min
const MIN_SPREAD = 0.02;              // spread mínimo 2%
```

---

## 📈 Métricas exibidas

- Preço YES/NO atual
- Volume 24h e último minuto
- Spread (%)
- Mudança de preço (1min, 5min)
- Sinal (COMPRAR YES / COMPRAR NO / AGUARDAR)
- Mini-gráfico (sparkline) do último hora
- Badge "🔥 BREAKING" se atende critérios

---

**Pronto?** Vou criar os arquivos! Dê OK para continuar.
