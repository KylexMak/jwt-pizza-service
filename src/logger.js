const config = require('./config');

class Logger {
  /**
   * Express middleware to log HTTP requests.
   */
  httpLogger = (req, res, next) => {
    // Save the original res.send function
    let send = res.send;

    // Create a new function to replace res.send
    res.send = (resBody) => {
      const logData = {
        authorized: !!req.headers.authorization,
        path: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        reqBody: this.sanitize(JSON.stringify(req.body)),
        resBody: this.sanitize(JSON.stringify(resBody)),
      };

      const level = this.statusToLogLevel(res.statusCode);

      this.log(level, 'http', logData);

      // Restore the original res.send
      res.send = send;
      
      // Call the original res.send
      return res.send(resBody);
    };

    next();
  };


  log(level, type, logData) {
    const labels = {
      // Use the 'source' from your config.js
      component: config.logging.source, 
      level: level,
      type: type,
    };

    const values = [this.nowString(), JSON.stringify(logData)];

    const logEvent = {
      streams: [
        {
          stream: labels,
          values: [values],
        },
      ],
    };

    this.sendLogToGrafana(logEvent);
  }

  statusToLogLevel(statusCode) {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warn';
    return 'info';
  }

  nowString() {
    // Date.now() is milliseconds, multiply by 1,000,000 for nanoseconds
    return (Math.floor(Date.now()) * 1000000).toString();
  }

  sanitize(logString) {
    // Regex to find "password": "any-value" and replace it
    return logString.replace(/\"password\":\s*\"[^\"]*\"/g, '"password": "*****"');
  }

  sendLogToGrafana(event) {
    const body = JSON.stringify(event);
    
    // Read credentials from the config.logging object
    const { url, userId, apiKey } = config.logging;

    fetch(url, {
      method: 'post',
      body: body,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userId}:${apiKey}`,
      },
    })
    .then((res) => {
      if (!res.ok) {
        console.error('Failed to send log to Grafana:', res.statusText);
        }
    })
    .catch((err) => {
      // Log to console if Grafana fetch fails
      console.error('Failed to send log to Grafana:', err.message);
    });
  }
}

// Export a single, shared instance of the Logger
module.exports = new Logger();