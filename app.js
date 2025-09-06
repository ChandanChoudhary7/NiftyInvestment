// Nifty Investment Tracker PWA - JavaScript
class NiftyTracker {
    constructor() {
        this.data = null;
        this.isOnline = navigator.onLine;
        this.refreshInterval = null;
        this.API_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
        this.SYMBOL = '^NSEI';
        
        // Thresholds
        this.THRESHOLDS = {
            RSI_OVERSOLD: 30,
            RSI_OVERBOUGHT: 70,
            PE_ATTRACTIVE: 21,
            PE_EXPENSIVE: 25,
            CORRECTION_THRESHOLD: 10,
            ALL_TIME_HIGH: 26277.35
        };

        // Market hours (IST)
        this.MARKET_HOURS = {
            start: { hour: 9, minute: 15 },
            end: { hour: 15, minute: 30 }
        };

        // Fallback data
        this.FALLBACK_DATA = {
            current_price: 24741.00,
            previous_close: 24734.30,
            open: 24818.85,
            high_52w: 26277.35,
            low_52w: 21743.65,
            all_time_high: 26277.35,
            pe_ratio: 21.73,
            rsi: 53.21,
            dma_200: 24631
        };

        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.registerServiceWorker();
        this.checkOnlineStatus();
        
        // Show loading initially
        this.showLoading();
        
        // Load cached data first if available
        this.loadCachedData();
        
        // Fetch fresh data
        await this.fetchNiftyData();
        
        // Setup auto-refresh if in market hours
        this.setupAutoRefresh();
        
        this.hideLoading();
    }

    setupEventListeners() {
        // Refresh button
        const refreshBtn = document.getElementById('refreshBtn');
        refreshBtn.addEventListener('click', () => this.manualRefresh());

        // Online/offline events
        window.addEventListener('online', () => this.handleOnlineStatus(true));
        window.addEventListener('offline', () => this.handleOnlineStatus(false));

        // Page visibility change
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.fetchNiftyData();
            }
        });
    }

    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                // Create service worker inline
                const swCode = `
                const CACHE_NAME = 'nifty-tracker-v1';
                const urlsToCache = [
                    './',
                    './index.html',
                    './style.css',
                    './app.js'
                ];

                self.addEventListener('install', event => {
                    event.waitUntil(
                        caches.open(CACHE_NAME)
                            .then(cache => cache.addAll(urlsToCache))
                    );
                });

                self.addEventListener('fetch', event => {
                    event.respondWith(
                        caches.match(event.request)
                            .then(response => {
                                return response || fetch(event.request);
                            }
                        )
                    );
                });
                `;

                const blob = new Blob([swCode], { type: 'application/javascript' });
                const swUrl = URL.createObjectURL(blob);
                
                await navigator.serviceWorker.register(swUrl);
                console.log('Service Worker registered successfully');
            } catch (error) {
                console.log('Service Worker registration failed:', error);
            }
        }
    }

    checkOnlineStatus() {
        this.isOnline = navigator.onLine;
        this.updateStatusIndicator();
    }

    handleOnlineStatus(online) {
        this.isOnline = online;
        this.updateStatusIndicator();
        
        if (online) {
            this.hideOfflineBanner();
            this.fetchNiftyData();
            this.setupAutoRefresh();
        } else {
            this.showOfflineBanner();
            this.clearAutoRefresh();
        }
    }

    updateStatusIndicator() {
        const statusDot = document.getElementById('statusDot');
        const statusText = document.getElementById('statusText');
        
        if (this.isOnline) {
            statusDot.className = 'status-dot online';
            statusText.textContent = 'Live';
        } else {
            statusDot.className = 'status-dot offline';
            statusText.textContent = 'Offline';
        }
    }

    isMarketHours() {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        
        const startMinutes = this.MARKET_HOURS.start.hour * 60 + this.MARKET_HOURS.start.minute;
        const endMinutes = this.MARKET_HOURS.end.hour * 60 + this.MARKET_HOURS.end.minute;
        const currentMinutes = currentHour * 60 + currentMinute;
        
        // Only on weekdays
        const isWeekday = now.getDay() >= 1 && now.getDay() <= 5;
        
        return isWeekday && currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }

    setupAutoRefresh() {
        this.clearAutoRefresh();
        
        if (this.isMarketHours() && this.isOnline) {
            this.refreshInterval = setInterval(() => {
                this.fetchNiftyData();
            }, 30000); // 30 seconds
        }
    }

    clearAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    async fetchNiftyData() {
        try {
            const url = `${this.API_BASE}${this.SYMBOL}?interval=1d&range=1y`;
            
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            await this.processYahooData(data);
            
        } catch (error) {
            console.error('Error fetching data:', error);
            this.useFallbackData();
        }
    }

    async processYahooData(yahooData) {
        try {
            const result = yahooData.chart.result[0];
            const meta = result.meta;
            const quote = result.indicators.quote[0];
            
            // Get latest values
            const prices = quote.close.filter(p => p !== null);
            const highs = quote.high.filter(h => h !== null);
            const lows = quote.low.filter(l => l !== null);
            
            const currentPrice = meta.regularMarketPrice || prices[prices.length - 1];
            const previousClose = meta.previousClose || prices[prices.length - 2];
            const open = meta.regularMarketOpen || quote.open[quote.open.length - 1];
            
            // Calculate 52-week high/low
            const high52w = Math.max(...highs);
            const low52w = Math.min(...lows);
            
            // Calculate 200 DMA
            const dma200 = this.calculate200DMA(prices);
            
            // Calculate RSI
            const rsi = this.calculateRSI(prices);
            
            this.data = {
                current_price: currentPrice,
                previous_close: previousClose,
                open: open,
                high_52w: high52w,
                low_52w: low52w,
                all_time_high: this.THRESHOLDS.ALL_TIME_HIGH,
                pe_ratio: this.FALLBACK_DATA.pe_ratio, // PE not available from Yahoo, use fallback
                rsi: rsi,
                dma_200: dma200,
                last_updated: new Date().toISOString()
            };
            
            this.cacheData();
            this.updateUI();
            
        } catch (error) {
            console.error('Error processing Yahoo data:', error);
            this.useFallbackData();
        }
    }

    calculate200DMA(prices) {
        if (prices.length < 200) {
            return this.FALLBACK_DATA.dma_200;
        }
        
        const last200 = prices.slice(-200);
        const sum = last200.reduce((acc, price) => acc + price, 0);
        return sum / last200.length;
    }

    calculateRSI(prices, period = 14) {
        if (prices.length < period + 1) {
            return this.FALLBACK_DATA.rsi;
        }
        
        const changes = [];
        for (let i = 1; i < prices.length; i++) {
            changes.push(prices[i] - prices[i - 1]);
        }
        
        const recentChanges = changes.slice(-period);
        const gains = recentChanges.filter(change => change > 0);
        const losses = recentChanges.filter(change => change < 0).map(loss => Math.abs(loss));
        
        const avgGain = gains.length ? gains.reduce((acc, gain) => acc + gain, 0) / period : 0;
        const avgLoss = losses.length ? losses.reduce((acc, loss) => acc + loss, 0) / period : 0;
        
        if (avgLoss === 0) return 100;
        
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    useFallbackData() {
        this.data = {
            ...this.FALLBACK_DATA,
            last_updated: new Date().toISOString()
        };
        this.updateUI();
    }

    cacheData() {
        try {
            localStorage.setItem('nifty-data', JSON.stringify(this.data));
        } catch (error) {
            console.error('Error caching data:', error);
        }
    }

    loadCachedData() {
        try {
            const cached = localStorage.getItem('nifty-data');
            if (cached) {
                this.data = JSON.parse(cached);
                this.updateUI();
            }
        } catch (error) {
            console.error('Error loading cached data:', error);
        }
    }

    updateUI() {
        if (!this.data) return;

        // Update current price
        document.getElementById('currentPrice').textContent = this.formatNumber(this.data.current_price);
        document.getElementById('previousClose').textContent = this.formatNumber(this.data.previous_close);
        document.getElementById('openPrice').textContent = this.formatNumber(this.data.open);

        // Update price change
        const change = this.data.current_price - this.data.previous_close;
        const changePercent = (change / this.data.previous_close) * 100;
        const priceChangeEl = document.getElementById('priceChange');
        priceChangeEl.textContent = `${change >= 0 ? '+' : ''}${this.formatNumber(change)} (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)`;
        priceChangeEl.className = `price-change ${change >= 0 ? 'positive' : 'negative'}`;

        // Update price levels
        document.getElementById('allTimeHigh').textContent = this.formatNumber(this.data.all_time_high);
        document.getElementById('high52w').textContent = this.formatNumber(this.data.high_52w);
        document.getElementById('low52w').textContent = this.formatNumber(this.data.low_52w);

        // Calculate and update correction/upside
        const correctionPercent = ((this.data.current_price - this.data.all_time_high) / this.data.all_time_high) * 100;
        const upsidePercent = ((this.data.all_time_high - this.data.current_price) / this.data.current_price) * 100;
        
        const correctionEl = document.getElementById('correctionPercent');
        correctionEl.textContent = `${correctionPercent.toFixed(2)}%`;
        correctionEl.className = `value ${correctionPercent < -10 ? 'positive' : 'negative'}`;
        
        const upsideEl = document.getElementById('upsidePercent');
        upsideEl.textContent = `${upsidePercent.toFixed(2)}%`;
        upsideEl.className = `value positive`;

        // Update technical indicators
        const rsiEl = document.getElementById('rsiValue');
        rsiEl.textContent = this.data.rsi.toFixed(2);
        rsiEl.className = `value ${this.data.rsi < this.THRESHOLDS.RSI_OVERSOLD ? 'positive' : 
                           this.data.rsi > this.THRESHOLDS.RSI_OVERBOUGHT ? 'negative' : 'neutral'}`;

        document.getElementById('dma200').textContent = this.formatNumber(this.data.dma_200);
        
        const dmaPositionEl = document.getElementById('dmaPosition');
        const aboveDMA = this.data.current_price > this.data.dma_200;
        dmaPositionEl.textContent = aboveDMA ? 'Above' : 'Below';
        dmaPositionEl.className = `value ${aboveDMA ? 'positive' : 'negative'}`;

        // Update PE ratio
        const peEl = document.getElementById('peRatio');
        peEl.textContent = this.data.pe_ratio.toFixed(2);
        peEl.className = `value ${this.data.pe_ratio < this.THRESHOLDS.PE_ATTRACTIVE ? 'attractive' : 
                          this.data.pe_ratio > this.THRESHOLDS.PE_EXPENSIVE ? 'expensive' : 'neutral'}`;

        // Update investment signal
        this.updateInvestmentSignal(correctionPercent);

        // Update last updated
        const lastUpdated = new Date(this.data.last_updated);
        document.getElementById('lastUpdated').textContent = `Last updated: ${lastUpdated.toLocaleTimeString()}`;
    }

    updateInvestmentSignal(correctionPercent) {
        const conditions = {
            correction: Math.abs(correctionPercent) >= this.THRESHOLDS.CORRECTION_THRESHOLD,
            rsi: this.data.rsi < this.THRESHOLDS.RSI_OVERSOLD,
            pe: this.data.pe_ratio < this.THRESHOLDS.PE_ATTRACTIVE
        };

        // Update individual conditions
        this.updateCondition('correctionCondition', conditions.correction, 
            `${Math.abs(correctionPercent).toFixed(1)}% correction`);
        this.updateCondition('rsiCondition', conditions.rsi, 
            `RSI: ${this.data.rsi.toFixed(1)}`);
        this.updateCondition('peCondition', conditions.pe, 
            `PE: ${this.data.pe_ratio.toFixed(1)}`);

        // Update overall signal
        const allConditionsMet = conditions.correction && conditions.rsi && conditions.pe;
        const signalBadge = document.getElementById('signalBadge');
        
        if (allConditionsMet) {
            signalBadge.textContent = 'BUY SIGNAL';
            signalBadge.className = 'signal-badge buy';
        } else {
            signalBadge.textContent = 'WAIT';
            signalBadge.className = 'signal-badge wait';
        }
    }

    updateCondition(elementId, met, details) {
        const conditionEl = document.getElementById(elementId);
        const statusEl = conditionEl.querySelector('.condition-status');
        
        statusEl.textContent = met ? '✓ Met' : '✗ Not Met';
        statusEl.className = `condition-status ${met ? 'met' : 'not-met'}`;
        
        // Update condition text with details
        const textEl = conditionEl.querySelector('.condition-text');
        textEl.textContent = textEl.textContent.split(' (')[0] + ` (${details})`;
    }

    formatNumber(num) {
        return new Intl.NumberFormat('en-IN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(num);
    }

    async manualRefresh() {
        const refreshBtn = document.getElementById('refreshBtn');
        refreshBtn.classList.add('spinning');
        
        await this.fetchNiftyData();
        
        setTimeout(() => {
            refreshBtn.classList.remove('spinning');
        }, 500);
    }

    showLoading() {
        document.getElementById('loadingOverlay').classList.add('show');
    }

    hideLoading() {
        document.getElementById('loadingOverlay').classList.remove('show');
    }

    showOfflineBanner() {
        document.getElementById('offlineBanner').classList.add('show');
    }

    hideOfflineBanner() {
        document.getElementById('offlineBanner').classList.remove('show');
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new NiftyTracker();
});

// Handle app install prompt
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    
    // Show install button or notification
    console.log('PWA install prompt available');
});

window.addEventListener('appinstalled', (evt) => {
    console.log('PWA was installed');
});
