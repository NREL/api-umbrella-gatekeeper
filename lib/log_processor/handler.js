'use strict';

var _ = require('underscore'),
    config = require('../config'),
    fivebeans = require('fivebeans'),
    logCleaner = require('./cleaner'),
    logger = require('../logger'),
    moment = require('moment');

var Handler = function() {
  this.initialize.apply(this, arguments);
};

module.exports.Handler = Handler;

_.extend(Handler.prototype, {
  type: 'api-umbrella-log',

  initialize: function(worker) {
    this.worker = worker;
    this.connectBeanstalk(this.handleConnect.bind(this));
  },

  connectBeanstalk: function(callback) {
    this.beanstalk = new fivebeans.client(config.get('beanstalkd.host'), config.get('beanstalkd.port'));

    this.beanstalk.
      on('connect', this.handleConnectSuccess.bind(this, callback)).
      on('error', this.handleConnectError.bind(this, callback));

    this.beanstalk.connect();
  },

  handleConnectSuccess: function(callback) {
    this.beanstalk.watch('api-umbrella-logs', function(error) {
      callback(error);
    });
  },

  handleConnectError: function(callback, error) {
    callback(error);
  },

  handleConnect: function(error) {
    if(error) {
      logger.error('Error connecting to beanstalkd: ' + error);
      return false;
    }

    this.reserve();
  },

  reserve: function() {
    this.beanstalk.reserve(function(error, jobId, payload) {
      if(error) {
        logger.error('Error reserving: ' + error);
      } else {
        this.handleJob(JSON.parse(payload.toString()).payload, jobId);
      }

      this.reserve();
    }.bind(this));
  },

  handleJob: function(payload, jobId) {
    if(!this.worker.combining[payload.uid]) {
      this.worker.combining[payload.uid] = {
        jobIds: [],
      };
    }

    this.worker.combining[payload.uid].jobIds.push(jobId);
    this.worker.combining[payload.uid][payload.source] = payload.data;

    this.beanstalk.release(jobId, 2000, 60 * 1, function(error) {
      if(error) {
        logger.error('Release error: ' + error);
      }
    });

    var jobIds = this.worker.combining[payload.uid].jobIds;
    if(jobIds.length === 3) {
      this.processCombined(payload.uid);
    } else if(jobIds.length === 1) {
      this.worker.combining[payload.uid].timer = setTimeout(function() {
        logger.info('Timed out...');
        this.processCombined(payload.uid);
      }.bind(this), config.get('logProcessor.fallbackTimeout'));
    }
  },

  fetchLogParts: function(uid) {
    var job = this.worker.combining[uid];
    delete this.worker.combining[uid];

    if(job.timer) {
      clearTimeout(job.timer);
      delete job.timer;
    }

    return job;
  },

  combineLogParts: function(data) {
    var combined = {};
    var part;

    if(data.gatekeeper) {
      part = data.gatekeeper;
      _.extend(combined, part);
    }

    if(data.api_router) {
      part = data.api_router;
      combined.backend_response_time = part.backend_response_time * 1000;
    }

    if(data.web_router) {
      part = data.web_router;

      combined.request_at = moment.unix(part.logged_at - part.response_time).toISOString();
      combined.response_status = part.response_status;
      combined.response_size = part.response_size;
      combined.request_size = part.request_size;
      combined.response_time = part.response_time * 1000;

      if(combined.hasOwnProperty('backend_response_time')) {
        combined.proxy_overhead = part.backend_response_time * 1000 - combined.backend_response_time;
      }

      if(!combined.hasOwnProperty('request_ip')) {
        combined.request_ip = part.request_ip;
      }

      if(!combined.hasOwnProperty('request_method')) {
        combined.request_method = part.request_method;
      }

      if(!combined.hasOwnProperty('request_url')) {
        combined.request_url = part.request_scheme + '://' + part.request_host + ':' + part.request_port + part.request_uri;
      }

      if(!combined.hasOwnProperty('request_user_agent')) {
        combined.request_user_agent = part.request_user_agent;
      }
    }

    return combined;
  },

  processCombined: function(uid) {
    var data = this.fetchLogParts(uid);
    var jobIds = data.jobIds;

    if(!data.gatekeeper && !data.web_router) {
      logger.error('Could not log');
      this.buryJobs(jobIds);
      return false;
    }

    if(!data.gatekeeper || !data.api_router || !data.web_router) {
      logger.warning('Incomplete log');
    }

    var combined = this.combineLogParts(data);
    logCleaner(this.elasticSearch, combined);

    logger.info(JSON.stringify(combined, null, 2));

    //console.info('Combined: ', combined.request_url);

    var index = 'api-umbrella-logs-' + moment(combined.request_at).format('YYYY-MM');
    this.worker.elasticSearch.index(index, 'log', combined, uid)
      .on('done', this.handleLogIndexed.bind(this, jobIds))
      .on('error', this.handleLogIndexError.bind(this, jobIds))
      .exec();
  },

  handleLogIndexed: function(jobIds) {
    this.deleteJobs(jobIds);
  },

  handleLogIndexError: function(jobIds, error) {
    logger.error('Index error: ' + error);
    this.delayJobs(jobIds);
  },

  buryJobs: function(jobIds) {
    jobIds.forEach(function(jobId) {
      this.beanstalk.bury(jobId, function(error) {
        if(error) {
          logger.error('Error destroying beanstalk job: ' + jobId + ' ' + error);
        }
      });
    }.bind(this));
  },

  delayJobs: function(jobIds) {
    jobIds.forEach(function(jobId) {
      this.beanstalk.release(jobId, 5000, 60 * 10, function(error) {
        if(error) {
          logger.error('Error destroying beanstalk job: ' + jobId + ' ' + error);
        }
      });
    }.bind(this));
  },

  deleteJobs: function(jobIds) {
    jobIds.forEach(function(jobId) {
      this.beanstalk.destroy(jobId, function(error) {
        if(error) {
          logger.error('Error destroying beanstalk job: ' + jobId + ' ' + error);
        }
      });
    }.bind(this));
  },

  close: function() {
    //this.beanstalk.quit();
  },
});
