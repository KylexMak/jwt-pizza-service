const os = require('os');
const config = require('./config');

/**
 * A class for collecting and sending application metrics to Grafana
 * using the OpenTelemetry (OTLP) JSON format.
 */
class Metrics {
  constructor() {
    // Active Users
    this.activeUsers = new Set();
    // HTTP Request Metrics
    this.requestsTotal = 0;
    this.requestLatencySum = 0; // Cumulative latency in ms
    this.requestGetCounts = 0;
    this.requestPostCounts = 0;
    this.requestPutCounts = 0;
    this.requestDeleteCounts = 0;
    
    // Auth Metrics (Example for later)
    this.authSuccess = 0;
    this.authFailure = 0;

    // Order Metrics
    this.pizzasSold = 0;
    this.pizzaCreationFailures = 0;
    this.totalRevenueCents = 0;

    //pizza latency
    this.pizzaCreationLatencySum = 0;
    this.pizzaCreationCount = 0;

    // Bind 'this' context for use in Express middleware
    this.requestTracker = this.requestTracker.bind(this);
  }

  // --- Core Metric Sending Function ---

  /**
   * Sends a metric payload to Grafana.
   * @param {string} metricName - The name of the metric (e.g., "system.cpu.usage")
   * @param {number} metricValue - The integer value of the metric.
   * @param {'gauge' | 'sum'} type - The metric type ('gauge' for values, 'sum' for counters).
   * @param {string} unit - The unit of the metric (e.g., "%", "ms", "1" for count).
   * @param {Object} [attributes={}] - Optional key-value attributes (labels).
   */
  _sendMetric(metricName, metricValue, type, unit) {
    
    const dataPoint = 
      {
        timeUnixNano: Date.now() * 1000000,
        // Convert attributes object to OTLP format
        attributes: [
            {
                key: 'source',
                value: { stringValue: config.metrics.source },
            }
        ]
      };
    if (Number.isInteger(metricValue)) {
        dataPoint.asInt = metricValue;
    } else{
        dataPoint.asDouble = metricValue;
    };
    
    const dataPoints = [dataPoint];

    const metric = {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: metricName,
                  unit: unit,
                  [type]: {
                    dataPoints: dataPoints,
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    // Add required fields for 'sum' metrics
    if (type === 'sum') {
      metric.resourceMetrics[0].scopeMetrics[0].metrics[0][type].aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
      metric.resourceMetrics[0].scopeMetrics[0].metrics[0][type].isMonotonic = true;
    }

    const body = JSON.stringify(metric);
    
    fetch(config.metrics.url, {
      method: 'POST',
      body: body,
      headers: { 
        Authorization: `Bearer ${config.metrics.apiKey}`,
        'Content-Type': 'application/json' 
      },
    })
      .then((response) => {
        if (!response.ok) {
          response.text().then((text) => {
            console.error(`Failed to push metrics to Grafana: ${response.status} ${text}\n${body}`);
          });
        } else {
          // This will be very noisy, recommend removing in production
          // console.log(`Pushed metric: ${metricName}`);
        }
      })
      .catch((error) => {
        console.error(`Error pushing metrics for ${metricName}:`, error);
      });
  }

  // --- System Metrics Collectors ---

  _getCpuUsagePercentage() {
    return new Promise((resolve) => {
      // Take the first snapshot of CPU times
      const startCpus = os.cpus();

      // Wait for 1 second (1000 milliseconds)
      setTimeout(() => {
        // Take the second snapshot
        const endCpus = os.cpus();

        let totalIdle = 0;
        let totalTick = 0;

        // Loop through each core
        for (let i = 0; i < startCpus.length; i++) {
          const start = startCpus[i].times;
          const end = endCpus[i].times;

          // Calculate the total ticks for this core during the interval
          const idle = end.idle - start.idle;
          const total = (end.user - start.user) + 
                        (end.nice - start.nice) + 
                        (end.sys - start.sys) + 
                        (end.irq - start.irq) + 
                        idle;

          // Add to the grand totals
          totalIdle += idle;
          totalTick += total;
        }

        // Calculate the percentages
        // Avoid divide-by-zero if totalTick is 0 (can happen on some systems)
        if (totalTick === 0) {
          return resolve(0);
        }
        
        const idlePercentage = totalIdle / totalTick;
        const usagePercentage = 100 * (1 - idlePercentage);

        // Return the rounded integer value
        resolve(Math.round(usagePercentage));

      }, 1000); // 1-second interval for measurement
    });
  }

  _getMemoryUsagePercentage() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsage = (usedMemory / totalMemory) * 100;
    
    return Math.round(memoryUsage); // Return as integer
  }

  // --- Public Methods for Metric Collection ---

  /**
   * Starts the periodic collection and sending of metrics.
   * @param {number} [interval=5000] - Interval in milliseconds to send metrics.
   */
  startMetricsCollection(interval = 5000) {
    console.log(`Starting metrics collection. Reporting to Grafana every ${interval}ms.`);
    const collectAndSendMetrics = async () => {
        // --- Send System Metrics (Gauge) ---
        const cpuValue = await this._getCpuUsagePercentage();
        const memValue = this._getMemoryUsagePercentage();
        this._sendMetric('system.cpu.usage', cpuValue, 'gauge', '%');
        this._sendMetric('system.memory.usage', memValue, 'gauge', '%');
        
        // --- Send HTTP Metrics (Sum) ---
        this._sendMetric('http.requests.total', this.requestsTotal, 'sum', '1');
        this._sendMetric('http.requests.latency.sum', Math.round(this.requestLatencySum), 'sum', 'ms');
        
        // Send requests by method
        this._sendMetric('http.requests.get.count', this.requestGetCounts, 'sum', '1');
        this._sendMetric('http.requests.post.count', this.requestPostCounts, 'sum', '1');
        this._sendMetric('http.requests.put.count', this.requestPutCounts, 'sum', '1');
        this._sendMetric('http.requests.delete.count', this.requestDeleteCounts, 'sum', '1');
        
        // --- Send Auth Metrics (Sum) ---
        // These are incremented by other parts of the app
        this._sendMetric('auth.attempts.success', this.authSuccess, 'sum', '1');
        this._sendMetric('auth.attempts.failure', this.authFailure, 'sum', '1');
        const activeUserCount = this.activeUsers.size;
        console.log(`[Metrics Loop] Active Users: ${activeUserCount}`);
        this._sendMetric('auth.users.active', activeUserCount, 'gauge', '1');

        console.log(`[Metrics Loop] Pizzas Sold: ${this.pizzasSold}, Pizza Creation Failures: ${this.pizzaCreationFailures}, Total Revenue (cents): ${this.totalRevenueCents}`);
        this._sendMetric('order.pizzas.sold', this.pizzasSold, 'sum', '1');
        this._sendMetric('order.pizza.creation.failures', this.pizzaCreationFailures, 'sum', '1');
        this._sendMetric('order.revenue.total_cents', this.totalRevenueCents, 'sum', '1');

        this._sendMetric('order.pizza.creation.latency.sum', this.pizzaCreationLatencySum, 'sum', 'ms');
        this._sendMetric('order.pizza.creation.count', this.pizzaCreationCount, 'sum', '1');
    };

    collectAndSendMetrics(); // Initial call
    setInterval(collectAndSendMetrics, interval);
  }


/**
 * Express middleware to track HTTP request metrics.
*/
requestTracker(req, res, next) {
    console.log(`[Metrics Loop] Reading GET count as: ${this.requestPutCounts}`);
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      try {
        const end = process.hrtime.bigint();
        // Convert nanoseconds to milliseconds
        const durationMs = Number(end - start) / 1000000; 

        // Increment internal counters
        this.requestsTotal++;
        this.requestLatencySum += durationMs;

        const method = req.method.toUpperCase();
        switch (method) {
          case 'GET':
            this.requestGetCounts++;
            break;
          case 'POST':
            this.requestPostCounts++;
            break;
          case 'PUT':
            this.requestPutCounts++;
            break;
          case 'DELETE':
            this.requestDeleteCounts++;
            break;
        }
      } catch (error) {
        console.error('Error in requestTracker metrics:', error);
      }
    });

    next();
  }

  incrementAuthSuccess() {
    this.authSuccess++;
  }

  incrementAuthFailure() {
    this.authFailure++;
  }

  addUserAsActive(userId) {
    this.activeUsers.add(userId);
  }

  removeUserFromActive(userId) {
    this.activeUsers.delete(userId);
  }

  incrementPizzasSold(count = 1) {
    this.pizzasSold += count;
  }

  incrementPizzaCreationFailure() {
    this.pizzaCreationFailures++;
  }

  addRevenue(amountCents) {
    console.log(`[Metrics] Adding revenue: ${amountCents} cents`);
    this.totalRevenueCents += amountCents;
  }

  recordPizzaCreationLatency(latencyMs) {
    this.pizzaCreationLatencySum += latencyMs;
    this.pizzaCreationCount++;
  }
  
  clearMetrics() {
    this.activeUsers.clear();
    this.requestsTotal = 0;
    this.requestLatencySum = 0;
    this.requestsByMethod = {
      GET: 0,
      POST: 0,
      PUT: 0,
      DELETE: 0,
    };
    this.authSuccess = 0;
    this.authFailure = 0;

    this.pizzasSold = 0;
    this.pizzaCreationFailures = 0;
    this.totalRevenueCents = 0;
    this.pizzaCreationLatencySum = 0;
    this.pizzaCreationCount = 0;
  }
  // You would add more methods here for:
  // - incrementPizzaSold(amount)
  // - incrementPizzaCreationFailure()
  // - addRevenue(amount)
  // - etc.
}

// Export a single instance (singleton pattern)
module.exports = new Metrics();