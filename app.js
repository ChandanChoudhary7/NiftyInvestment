// Enhanced Nifty Investment Tracker with EMA Crossover Analysis
class NiftyEMATracker {
    constructor() {
        this.data = null;
        this.historicalData = [];
        this.emaData = {
            ema20: [],
            ema50: [],
            crossovers: []
        };
        this.isOnline = navigator.onLine;
        this.refreshInterval = null;
        this.API_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
        this.SYMBOL = '^NSEI';
        
        // Calculation constants
        this.THRESHOLDS = {
            RSI_OVERSOLD: 30,
            RSI_OVERBOUGHT: 70,
            PE_ATTRACTIVE: 21,
            PE_EXPENSIVE: 25,
            CORRECTION_THRESHOLD: 10,
            ALL_TIME_HIGH: 26277.35,
            EMA_PERIOD_20: 20,
            EMA_PERIOD_50: 50
        };

        // Market hours (IST)
        this.MARKET_HOURS = {
            start: { hour: 9, minute: 15 },
            end: { hour: 15, minute: 30 }
        };

        // Enhanced fallback data with historical prices
        this.FALLBACK_DATA = {
            current_price: 24741.00,
            previous_close: 24734.30,
            open: 24818.85,
            high_52w: 26277.35,
            low_52w: 21743.65,
            all_time_high: 26277.35,
            pe_ratio: 21.73,
            rsi: 53.21,
            dma_200: 24631,
            ema_20: 24750.25,
            ema_50: 24680.15,
            ema_trend: 'BULLISH',
            last_crossover: '2024-08-15',
            crossover_type: 'BULLISH_CROSS',
            days_since_cross: 22
        };

        // Sample historical data for EMA calculation
        this.FALLBACK_HISTORICAL = this.generateFallbackHistoricalData();

        this.init();
    }

    generateFallbackHistoricalData() {
        const data = [];
        const basePrice = 24000;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 100);

        for (let i = 0; i < 100; i++) {
            const date = new Date(startDate);
            date.setDate(date.getDate() + i);
            
            // Generate realistic price movement
            const randomFactor = (Math.random() - 0.5) * 0.03; // ±3% daily movement
            const trendFactor = i < 50 ? -0.001 : 0.002; // Bear then bull trend
            const price = basePrice * (1 + (randomFactor + trendFactor) * i / 10);
            
            data.push({
                date: date.toISOString().split('T')[0],
                close: Math.round(price * 100) / 100,
                high: Math.round(price * 1.02 * 100) / 100,
                low: Math.round(price * 0.98 * 100) / 100,
                open: Math.round(price * (1 + (Math.random() - 0.5) * 0.01) * 100) / 100,
                volume: Math.floor(Math.random() * 1000000) + 500000
            });
        }
        
        return data;
    }

    async init() {
        this.setupEventListeners();
        this.registerServiceWorker();
        this.checkOnlineStatus();
        
        this.showLoading();
        this.loadCachedData();
        
        // Fetch fresh data and historical data
        await Promise.all([
            this.fetchNiftyData(),
            this.fetchHistoricalData()
        ]);
        
        this.calculateEMAs();
        this.detectCrossovers();
        this.updateUI();
        this.setupAutoRefresh();
        
        this.hideLoading();
    }

    setupEventListeners() {
        const refreshBtn = document.getElementById('refreshBtn');
        refreshBtn?.addEventListener('click', () => this.manualRefresh());

        window.addEventListener('online', () => this.handleOnlineStatus(true));
        window.addEventListener('offline', () => this.handleOnlineStatus(false));

        // Visibility change for auto-refresh management
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.setupAutoRefresh();
            } else {
                this.clearAutoRefresh();
            }
        });
    }

    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                await navigator.serviceWorker.register('./sw.js');
                console.log('Service Worker registered successfully');
            } catch (error) {
                console.error('Service Worker registration failed:', error);
            }
        }
    }

    async fetchHistoricalData() {
        try {
            const endDate = Math.floor(Date.now() / 1000);
            const startDate = endDate - (100 * 24 * 60 * 60); // 100 days ago
            
            const url = `${this.API_BASE}${this.SYMBOL}?period1=${startDate}&period2=${endDate}&interval=1d`;
            const response = await fetch(url);
            
            if (!response.ok) throw new Error('Failed to fetch historical data');
            
            const data = await response.json();
            this.processHistoricalData(data);
            
            // Cache historical data
            this.cacheData('nifty_historical', this.historicalData);
        } catch (error) {
            console.error('Error fetching historical data:', error);
            this.historicalData = this.FALLBACK_HISTORICAL;
        }
    }

    processHistoricalData(data) {
        try {
            const result = data.chart.result[0];
            const timestamps = result.timestamp;
            const quotes = result.indicators.quote[0];
            
            this.historicalData = timestamps.map((timestamp, index) => ({
                date: new Date(timestamp * 1000).toISOString().split('T')[0],
                close: quotes.close[index],
                high: quotes.high[index],
                low: quotes.low[index],
                open: quotes.open[index],
                volume: quotes.volume[index]
            })).filter(item => item.close !== null);
            
        } catch (error) {
            console.error('Error processing historical data:', error);
            this.historicalData = this.FALLBACK_HISTORICAL;
        }
    }

    calculateEMAs() {
        if (this.historicalData.length < 50) {
            console.warn('Insufficient historical data for EMA calculation');
            return;
        }

        const closePrices = this.historicalData.map(item => item.close);
        
        this.emaData.ema20 = this.calculateEMA(closePrices, this.THRESHOLDS.EMA_PERIOD_20);
        this.emaData.ema50 = this.calculateEMA(closePrices, this.THRESHOLDS.EMA_PERIOD_50);
        
        // Cache EMA data
        this.cacheData('nifty_ema', this.emaData);
    }

    calculateEMA(prices, period) {
        if (prices.length < period) return [];
        
        const k = 2 / (period + 1);
        const emaValues = [];
        
        // Start with SMA for the first value
        let sma = 0;
        for (let i = 0; i < period; i++) {
            sma += prices[i];
        }
        sma = sma / period;
        emaValues.push(sma);
        
        // Calculate EMA for remaining values
        for (let i = period; i < prices.length; i++) {
            const ema = (prices[i] * k) + (emaValues[emaValues.length - 1] * (1 - k));
            emaValues.push(ema);
        }
        
        return emaValues;
    }

    detectCrossovers() {
        if (this.emaData.ema20.length < 2 || this.emaData.ema50.length < 2) {
            return;
        }
        
        const crossovers = [];
        const startIndex = Math.max(this.THRESHOLDS.EMA_PERIOD_50 - this.THRESHOLDS.EMA_PERIOD_20, 1);
        
        for (let i = startIndex; i < this.emaData.ema20.length; i++) {
            const current20 = this.emaData.ema20[i];
            const current50 = this.emaData.ema50[i - startIndex + this.THRESHOLDS.EMA_PERIOD_20 - 1];
            const prev20 = this.emaData.ema20[i - 1];
            const prev50 = this.emaData.ema50[i - startIndex + this.THRESHOLDS.EMA_PERIOD_20 - 2];
            
            if (!current20 || !current50 || !prev20 || !prev50) continue;
            
            let crossoverType = null;
            
            // Bullish crossover: 20 EMA crosses above 50 EMA
            if (prev20 <= prev50 && current20 > current50) {
                crossoverType = 'BULLISH_CROSS';
            }
            // Bearish crossover: 20 EMA crosses below 50 EMA
            else if (prev20 >= prev50 && current20 < current50) {
                crossoverType = 'BEARISH_CROSS';
            }
            
            if (crossoverType) {
                crossovers.push({
                    date: this.historicalData[i].date,
                    type: crossoverType,
                    price: this.historicalData[i].close,
                    ema20: current20,
                    ema50: current50
                });
            }
        }
        
        this.emaData.crossovers = crossovers;
    }

    getCurrentEMATrend() {
        if (this.emaData.ema20.length === 0 || this.emaData.ema50.length === 0) {
            return {
                trend: 'UNKNOWN',
                ema20: null,
                ema50: null,
                lastCrossover: null,
                daysSinceCross: null
            };
        }
        
        const current20 = this.emaData.ema20[this.emaData.ema20.length - 1];
        const current50 = this.emaData.ema50[this.emaData.ema50.length - 1];
        const trend = current20 > current50 ? 'BULLISH' : 'BEARISH';
        
        const lastCrossover = this.emaData.crossovers.length > 0 
            ? this.emaData.crossovers[this.emaData.crossovers.length - 1]
            : null;
            
        let daysSinceCross = null;
        if (lastCrossover) {
            const crossDate = new Date(lastCrossover.date);
            const today = new Date();
            daysSinceCross = Math.floor((today - crossDate) / (1000 * 60 * 60 * 24));
        }
        
        return {
            trend,
            ema20: current20,
            ema50: current50,
            lastCrossover,
            daysSinceCross
        };
    }

    async fetchNiftyData() {
        try {
            const response = await fetch(`${this.API_BASE}${this.SYMBOL}`);
            
            if (!response.ok) throw new Error('Failed to fetch data');
            
            const data = await response.json();
            this.processNiftyData(data);
            this.cacheData('nifty_current', this.data);
            
        } catch (error) {
            console.error('Error fetching Nifty data:', error);
            this.useFallbackData();
        }
    }

    processNiftyData(response) {
        try {
            const result = response.chart.result[0];
            const meta = result.meta;
            
            this.data = {
                current_price: meta.regularMarketPrice || meta.previousClose,
                previous_close: meta.previousClose,
                open: meta.regularMarketOpen || meta.previousClose,
                high_52w: meta.fiftyTwoWeekHigh,
                low_52w: meta.fiftyTwoWeekLow,
                all_time_high: this.THRESHOLDS.ALL_TIME_HIGH,
                // These would need separate API calls in production
                pe_ratio: this.FALLBACK_DATA.pe_ratio,
                rsi: this.FALLBACK_DATA.rsi,
                dma_200: this.FALLBACK_DATA.dma_200,
                last_updated: new Date().toISOString()
            };
            
        } catch (error) {
            console.error('Error processing Nifty data:', error);
            this.useFallbackData();
        }
    }

    useFallbackData() {
        this.data = { ...this.FALLBACK_DATA };
        this.data.last_updated = new Date().toISOString();
    }

    calculateInvestmentSignals() {
        if (!this.data) return null;
        
        // Value Strategy (Original)
        const correction = this.calculateCorrection();
        const valueConditions = {
            correction: correction <= -this.THRESHOLDS.CORRECTION_THRESHOLD,
            rsi: this.data.rsi < this.THRESHOLDS.RSI_OVERSOLD,
            pe: this.data.pe_ratio < this.THRESHOLDS.PE_ATTRACTIVE
        };
        
        const valueSignal = Object.values(valueConditions).every(c => c) ? 'BUY' : 'WAIT';
        
        // Momentum Strategy (EMA)
        const emaTrend = this.getCurrentEMATrend();
        const momentumConditions = {
            bullishTrend: emaTrend.trend === 'BULLISH',
            recentCross: emaTrend.lastCrossover && 
                        emaTrend.lastCrossover.type === 'BULLISH_CROSS' && 
                        emaTrend.daysSinceCross < 30,
            priceAboveEMAs: this.data.current_price > emaTrend.ema20 && 
                           this.data.current_price > emaTrend.ema50
        };
        
        const momentumSignal = momentumConditions.bullishTrend ? 'BUY' : 
                              (emaTrend.trend === 'BEARISH' ? 'AVOID' : 'WAIT');
        
        // Combined Signal
        let combinedSignal = 'WAIT';
        if (valueSignal === 'BUY' && momentumSignal === 'BUY') {
            combinedSignal = 'STRONG BUY';
        } else if (valueSignal === 'BUY' || momentumSignal === 'BUY') {
            combinedSignal = 'BUY';
        } else if (momentumSignal === 'AVOID') {
            combinedSignal = 'AVOID';
        }
        
        return {
            value: {
                signal: valueSignal,
                conditions: valueConditions,
                description: this.getValueStrategyDescription(valueConditions)
            },
            momentum: {
                signal: momentumSignal,
                conditions: momentumConditions,
                description: this.getMomentumStrategyDescription(emaTrend),
                trend: emaTrend
            },
            combined: {
                signal: combinedSignal,
                description: this.getCombinedDescription(combinedSignal)
            }
        };
    }

    getValueStrategyDescription(conditions) {
        const metCount = Object.values(conditions).filter(c => c).length;
        if (metCount === 3) return 'All value conditions met - Strong buy opportunity';
        if (metCount === 2) return 'Most value conditions met - Consider buying';
        if (metCount === 1) return 'Few conditions met - Wait for better entry';
        return 'No value conditions met - Avoid buying';
    }

    getMomentumStrategyDescription(trend) {
        if (trend.trend === 'BULLISH') {
            if (trend.daysSinceCross < 10) {
                return 'Fresh bullish crossover - Strong momentum';
            } else if (trend.daysSinceCross < 30) {
                return 'Bullish trend continues - Good momentum';
            } else {
                return 'Extended bullish trend - Monitor for reversal';
            }
        } else if (trend.trend === 'BEARISH') {
            return 'Bearish trend - Avoid new positions';
        }
        return 'Trend unclear - Wait for confirmation';
    }

    getCombinedDescription(signal) {
        switch (signal) {
            case 'STRONG BUY': return 'Both strategies bullish - Excellent opportunity';
            case 'BUY': return 'One strategy bullish - Good opportunity';
            case 'AVOID': return 'Bearish momentum - Avoid new positions';
            default: return 'Mixed signals - Wait for clarity';
        }
    }

    calculateCorrection() {
        if (!this.data) return 0;
        return ((this.data.current_price - this.data.all_time_high) / this.data.all_time_high) * 100;
    }

    calculateUpside() {
        if (!this.data) return 0;
        return ((this.data.all_time_high - this.data.current_price) / this.data.current_price) * 100;
    }

    updateUI() {
        if (!this.data) return;
        
        this.updateMarketData();
        this.updateTechnicalIndicators();
        this.updateEMAAnalysis();
        this.updateInvestmentSignals();
        this.updateLastUpdated();
    }

    updateMarketData() {
        const elements = {
            currentPrice: document.getElementById('currentPrice'),
            previousClose: document.getElementById('previousClose'),
            dayOpen: document.getElementById('dayOpen'),
            allTimeHigh: document.getElementById('allTimeHigh'),
            week52High: document.getElementById('week52High'),
            week52Low: document.getElementById('week52Low'),
            correction: document.getElementById('correction'),
            upside: document.getElementById('upside')
        };
        
        const change = this.data.current_price - this.data.previous_close;
        const changePercent = (change / this.data.previous_close) * 100;
        
        if (elements.currentPrice) {
            elements.currentPrice.innerHTML = `
                <div class="card-value ${change >= 0 ? 'positive' : 'negative'}">
                    ₹${this.formatNumber(this.data.current_price)}
                </div>
                <div class="card-change ${change >= 0 ? 'positive' : 'negative'}">
                    ${change >= 0 ? '↗' : '↘'} ₹${Math.abs(change).toFixed(2)} (${changePercent.toFixed(2)}%)
                </div>
            `;
        }
        
        if (elements.previousClose) {
            elements.previousClose.textContent = `₹${this.formatNumber(this.data.previous_close)}`;
        }
        
        if (elements.dayOpen) {
            elements.dayOpen.textContent = `₹${this.formatNumber(this.data.open)}`;
        }
        
        if (elements.allTimeHigh) {
            elements.allTimeHigh.textContent = `₹${this.formatNumber(this.data.all_time_high)}`;
        }
        
        if (elements.week52High) {
            elements.week52High.textContent = `₹${this.formatNumber(this.data.high_52w)}`;
        }
        
        if (elements.week52Low) {
            elements.week52Low.textContent = `₹${this.formatNumber(this.data.low_52w)}`;
        }
        
        const correction = this.calculateCorrection();
        if (elements.correction) {
            elements.correction.innerHTML = `
                <span class="${correction <= -10 ? 'positive' : 'negative'}">
                    ${correction.toFixed(2)}%
                </span>
            `;
        }
        
        const upside = this.calculateUpside();
        if (elements.upside) {
            elements.upside.innerHTML = `
                <span class="positive">${upside.toFixed(2)}%</span>
            `;
        }
    }

    updateTechnicalIndicators() {
        const elements = {
            rsi: document.getElementById('rsiValue'),
            dma200: document.getElementById('dma200'),
            peRatio: document.getElementById('peRatio')
        };
        
        if (elements.rsi) {
            const rsiClass = this.data.rsi < 30 ? 'positive' : 
                           (this.data.rsi > 70 ? 'negative' : 'neutral');
            elements.rsi.innerHTML = `
                <span class="${rsiClass}">${this.data.rsi.toFixed(2)}</span>
            `;
        }
        
        if (elements.dma200) {
            const dmaClass = this.data.current_price > this.data.dma_200 ? 'positive' : 'negative';
            elements.dma200.innerHTML = `
                ₹${this.formatNumber(this.data.dma_200)}
                <div class="card-meta ${dmaClass}">
                    Price ${this.data.current_price > this.data.dma_200 ? 'above' : 'below'} 200 DMA
                </div>
            `;
        }
        
        if (elements.peRatio) {
            const peClass = this.data.pe_ratio < 21 ? 'positive' : 
                           (this.data.pe_ratio > 25 ? 'negative' : 'neutral');
            elements.peRatio.innerHTML = `
                <span class="${peClass}">${this.data.pe_ratio.toFixed(2)}</span>
            `;
        }
    }

    updateEMAAnalysis() {
        const trend = this.getCurrentEMATrend();
        const emaSection = document.getElementById('emaAnalysis');
        
        if (!emaSection || !trend.ema20 || !trend.ema50) return;
        
        const trendClass = trend.trend === 'BULLISH' ? 'bullish' : 'bearish';
        const trendIcon = trend.trend === 'BULLISH' ? '📈' : '📉';
        const crossoverText = trend.lastCrossover 
            ? `${trend.lastCrossover.type === 'BULLISH_CROSS' ? 'Bullish' : 'Bearish'} (${trend.daysSinceCross} days ago)`
            : 'No recent crossover';
        
        emaSection.innerHTML = `
            <div class="ema-values">
                <div class="ema-value">
                    <div class="ema-label">20 EMA</div>
                    <div class="ema-price positive">₹${this.formatNumber(trend.ema20)}</div>
                </div>
                <div class="ema-value">
                    <div class="ema-label">50 EMA</div>
                    <div class="ema-price positive">₹${this.formatNumber(trend.ema50)}</div>
                </div>
            </div>
            <div class="ema-trend ${trendClass}">
                <div style="font-size: 1.2rem;">${trendIcon}</div>
                <div>
                    <div style="font-weight: 600; text-transform: uppercase;">
                        ${trend.trend} TREND
                    </div>
                    <div style="font-size: 0.85rem; opacity: 0.8;">
                        Last Crossover: ${crossoverText}
                    </div>
                </div>
            </div>
        `;
    }

    updateInvestmentSignals() {
        const signals = this.calculateInvestmentSignals();
        if (!signals) return;
        
        const signalCard = document.getElementById('investmentSignal');
        if (!signalCard) return;
        
        const signalClass = signals.combined.signal.toLowerCase().includes('buy') ? 'buy' : 
                           (signals.combined.signal === 'AVOID' ? 'avoid' : 'wait');
        
        signalCard.className = `signal-card ${signalClass}`;
        signalCard.innerHTML = `
            <div class="signal-header">
                <div class="signal-status ${signalClass}">${signals.combined.signal}</div>
                <div class="signal-description">${signals.combined.description}</div>
            </div>
            <div class="signal-strategies">
                <div class="strategy-card ${this.getStrategyClass(signals.value.signal)}">
                    <div class="strategy-title">📊 Value Strategy</div>
                    <div class="strategy-signal ${this.getStrategyClass(signals.value.signal)}">${signals.value.signal}</div>
                    <div class="strategy-details">${signals.value.description}</div>
                    <ul class="conditions">
                        ${this.renderConditions(signals.value.conditions)}
                    </ul>
                </div>
                <div class="strategy-card ${this.getStrategyClass(signals.momentum.signal)}">
                    <div class="strategy-title">⚡ Momentum Strategy</div>
                    <div class="strategy-signal ${this.getStrategyClass(signals.momentum.signal)}">${signals.momentum.signal}</div>
                    <div class="strategy-details">${signals.momentum.description}</div>
                    <div class="conditions">
                        <div class="condition">
                            <span class="condition-text">EMA Trend</span>
                            <span class="condition-status ${signals.momentum.conditions.bullishTrend ? 'met' : 'not-met'}">
                                ${signals.momentum.trend.trend}
                            </span>
                        </div>
                        <div class="condition">
                            <span class="condition-text">Recent Cross</span>
                            <span class="condition-status ${signals.momentum.conditions.recentCross ? 'met' : 'not-met'}">
                                ${signals.momentum.conditions.recentCross ? 'YES' : 'NO'}
                            </span>
                        </div>
                        <div class="condition">
                            <span class="condition-text">Price > EMAs</span>
                            <span class="condition-status ${signals.momentum.conditions.priceAboveEMAs ? 'met' : 'not-met'}">
                                ${signals.momentum.conditions.priceAboveEMAs ? 'YES' : 'NO'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    getStrategyClass(signal) {
        if (signal.includes('BUY')) return 'bullish';
        if (signal === 'AVOID') return 'bearish';
        return 'neutral';
    }

    renderConditions(conditions) {
        return Object.entries(conditions).map(([key, met]) => {
            const labels = {
                correction: '10%+ Correction',
                rsi: 'RSI < 30',
                pe: 'PE < 21'
            };
            
            return `
                <li class="condition">
                    <span class="condition-text">${labels[key]}</span>
                    <span class="condition-status ${met ? 'met' : 'not-met'}">
                        ${met ? 'MET' : 'NOT MET'}
                    </span>
                </li>
            `;
        }).join('');
    }

    updateLastUpdated() {
        const element = document.getElementById('lastUpdated');
        if (element && this.data) {
            const updateTime = new Date(this.data.last_updated);
            element.textContent = `Last updated: ${updateTime.toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })} IST`;
        }
    }

    formatNumber(num) {
        if (num >= 1000) {
            return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
        }
        return num.toFixed(2);
    }

    async manualRefresh() {
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<span class="pulse">↻</span> Refreshing...';
        }
        
        this.showLoading();
        
        await Promise.all([
            this.fetchNiftyData(),
            this.fetchHistoricalData()
        ]);
        
        this.calculateEMAs();
        this.detectCrossovers();
        this.updateUI();
        
        this.hideLoading();
        
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = '↻ Refresh';
        }
    }

    isMarketHours() {
        const now = new Date();
        const istTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
        const hours = istTime.getHours();
        const minutes = istTime.getMinutes();
        const currentMinutes = hours * 60 + minutes;
        
        const startMinutes = this.MARKET_HOURS.start.hour * 60 + this.MARKET_HOURS.start.minute;
        const endMinutes = this.MARKET_HOURS.end.hour * 60 + this.MARKET_HOURS.end.minute;
        
        // Check if it's a weekday (Monday = 1, Sunday = 0)
        const dayOfWeek = istTime.getDay();
        const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
        
        return isWeekday && currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }

    setupAutoRefresh() {
        this.clearAutoRefresh();
        
        if (this.isMarketHours()) {
            this.refreshInterval = setInterval(async () => {
                await this.fetchNiftyData();
                this.updateUI();
            }, 30000); // 30 seconds during market hours
        } else {
            this.refreshInterval = setInterval(async () => {
                await this.fetchNiftyData();
                this.updateUI();
            }, 300000); // 5 minutes after hours
        }
    }

    clearAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    handleOnlineStatus(isOnline) {
        this.isOnline = isOnline;
        const statusElement = document.getElementById('connectionStatus');
        
        if (statusElement) {
            statusElement.className = `status-indicator ${isOnline ? 'status-online' : 'status-offline'}`;
            statusElement.innerHTML = `
                <span style="width: 8px; height: 8px; border-radius: 50%; background: ${isOnline ? 'var(--green)' : 'var(--red)'}"></span>
                ${isOnline ? 'Online' : 'Offline'}
            `;
        }
        
        if (isOnline) {
            this.setupAutoRefresh();
        } else {
            this.clearAutoRefresh();
        }
    }

    checkOnlineStatus() {
        this.handleOnlineStatus(navigator.onLine);
    }

    showLoading() {
        document.querySelectorAll('.card').forEach(card => {
            card.classList.add('loading');
        });
        
        const loadingElement = document.getElementById('loadingIndicator');
        if (loadingElement) {
            loadingElement.textContent = 'Updating data...';
            loadingElement.classList.remove('hidden');
        }
    }

    hideLoading() {
        document.querySelectorAll('.card').forEach(card => {
            card.classList.remove('loading');
        });
        
        const loadingElement = document.getElementById('loadingIndicator');
        if (loadingElement) {
            loadingElement.classList.add('hidden');
        }
    }

    cacheData(key, data) {
        try {
            const cacheData = {
                data: data,
                timestamp: Date.now(),
                version: '2.0'
            };
            localStorage.setItem(key, JSON.stringify(cacheData));
        } catch (error) {
            console.error('Error caching data:', error);
        }
    }

    loadCachedData() {
        try {
            const currentData = localStorage.getItem('nifty_current');
            const historicalData = localStorage.getItem('nifty_historical');
            const emaData = localStorage.getItem('nifty_ema');
            
            if (currentData) {
                const cached = JSON.parse(currentData);
                if (cached.version === '2.0' && Date.now() - cached.timestamp < 600000) { // 10 min
                    this.data = cached.data;
                }
            }
            
            if (historicalData) {
                const cached = JSON.parse(historicalData);
                if (cached.version === '2.0' && Date.now() - cached.timestamp < 3600000) { // 1 hour
                    this.historicalData = cached.data;
                }
            }
            
            if (emaData) {
                const cached = JSON.parse(emaData);
                if (cached.version === '2.0' && Date.now() - cached.timestamp < 3600000) { // 1 hour
                    this.emaData = cached.data;
                }
            }
            
        } catch (error) {
            console.error('Error loading cached data:', error);
        }
    }
}

// Initialize the enhanced tracker when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new NiftyEMATracker());
} else {
    new NiftyEMATracker();
}
