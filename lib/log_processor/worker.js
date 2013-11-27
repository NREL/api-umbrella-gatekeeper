'use strict';

var _ = require('lodash'),
    async = require('async'),
    config = require('../config'),
    Convoy = require('redis-convoy'),
    ElasticSearchClient = require('elasticsearchclient'),
    events = require('events'),
    fs = require('fs'),
    logCleaner = require('./cleaner'),
    logger = require('../logger'),
    moment = require('moment'),
    path = require('path'),
    GatekeeperLogger = require('../gatekeeper/logger').Logger,
    redis = require('redis'),
    util = require('util');

var Worker = function() {
  this.initialize.apply(this, arguments);
};

module.exports.Worker = Worker;

util.inherits(Worker, events.EventEmitter);
_.extend(Worker.prototype, {
  initialize: function() {
    async.parallel([
      this.connectRedis.bind(this),
      this.connectElasticsearch.bind(this),
    ], this.handleConnections.bind(this));
  },

  connectRedis: function(asyncReadyCallback) {
    this.redis = redis.createClient(config.get('redis'));

    this.redis.on('error', function(error) {
      asyncReadyCallback(error);
    });

    this.redis.on('ready', function() {
      asyncReadyCallback(null);
    });
  },

  connectElasticsearch: function(asyncReadyCallback) {
    this.elasticSearch = new ElasticSearchClient(config.get('elasticsearch'));

    var templatesPath = path.join(process.cwd(), 'config', 'elasticsearch_templates.json');
    fs.readFile(templatesPath, this.handleElasticsearchReadTemplate.bind(this, asyncReadyCallback));
  },

  handleElasticsearchReadTemplate: function(asyncReadyCallback, error, templates) {
    templates = JSON.parse(templates.toString());
    async.each(templates, function(template, eachCallback) {
      this.elasticSearch.defineTemplate(template.id, template.template, function() {
        eachCallback(null);
      }.bind(this));
    }.bind(this), function() {
      asyncReadyCallback(null);
    });
  },

  handleConnections: function(error) {
    if(error) {
      logger.error('Log processor worker connections error: ', error);
      process.exit(1);
      return false;
    }

    this.gatekeeperLogger = new GatekeeperLogger(this.redis);

    this.queue = Convoy.createQueue('log_queue');
    this.queue.process(this.processQueue.bind(this));

    this.fetchJobs();

    this.emit('ready');
  },

  fetchJobs: function() {
    this.gatekeeperLogger.fetchJobs(this.handleJobs.bind(this));
  },

  handleJobs: function(error, ids) {
    async.each(ids, function(id, asyncCallback) {
      // Push our log jobs onto the convoy queue. The convoy queue ensures
      // individual jobs will only get processed once, and allows multiple
      // worker processes to pull items off the queue (but it doesn't allow for
      // time delayed jobs, so that's why we have our own simplified
      // intermediate jobs).
      var job = new Convoy.Job(id);
      this.queue.addJob(job, function(error) {
        if(error && error !== 'committed') {
          asyncCallback(error);
          return false;
        }

        this.gatekeeperLogger.deleteJob(id, asyncCallback);
      }.bind(this));
    }.bind(this), function() {
      // Look for new log jobs again after all the current stack of jobs have
      // been pushed onto the convoy queue.
      setTimeout(this.fetchJobs.bind(this), 5000);
    }.bind(this));
  },

  processQueue: function(job, done) {
    this.gatekeeperLogger.fetchLog(job.id, this.handleLogFetch.bind(this, job.id, done));
  },

  handleLogFetch: function(id, done, error, log) {
    if(error) {
      done(error);
      return false;
    }

    // FIXME: This condition shouldn't happen, but it seemed to crop up and
    // cause terrible deaths when doing heavy load testing. It must be some
    // race condition, but this should be revisited. All of this logging
    // aggregation stuff could actually use a revisit and cleanup.
    if(!log) {
      logger.error('Log Fetch Error - No Log: ' + id);
      done(error);
      return false;
    }

    var combined = {};
    var data;

    if(log.proxy) {
      data = JSON.parse(log.proxy);
      _.extend(combined, data);
    }

    if(log.api_router) {
      data = JSON.parse(log.api_router);
      combined.backend_response_time = data.backend_response_time * 1000;
    }

    if(log.web_router) {
      data = JSON.parse(log.web_router);

      combined.request_at = moment.unix(data.logged_at - data.response_time).toISOString();
      combined.response_status = data.response_status;
      combined.response_size = data.response_size;
      combined.request_size = data.request_size;
      combined.response_time = data.response_time * 1000;

      if(combined.hasOwnProperty('backend_response_time')) {
        combined.proxy_overhead = data.backend_response_time * 1000 - combined.backend_response_time;
      }

      if(!combined.hasOwnProperty('request_ip')) {
        combined.request_ip = data.request_ip;
      }

      if(!combined.hasOwnProperty('request_method')) {
        combined.request_method = data.request_method;
      }

      if(!combined.hasOwnProperty('request_url')) {
        combined.request_url = data.request_scheme + '://' + data.request_host + ':' + data.request_port + data.request_uri;
      }

      if(!combined.hasOwnProperty('request_user_agent')) {
        combined.request_user_agent = data.request_user_agent;
      }
    }

    logCleaner(this.elasticSearch, combined);

    //logger.info(combined);

    var index = 'api-umbrella-logs-' + moment(log.request_at).format('YYYY-MM');
    this.elasticSearch.index(index, 'log', combined, id)
      .on('done', this.handleLogIndexed.bind(this, id, done))
      .on('error', this.handleLogIndexError.bind(this, done))
      .exec();
  },

  handleLogIndexed: function(id, done) {
    this.gatekeeperLogger.deleteLog(id);
    done(null);
  },

  handleLogIndexError: function(done, error) {
    logger.error('Index log error: ', error);
    done(error);
  },

  close: function(callback) {
    if(this.redis) {
      this.redis.quit();
    }

    if(callback) {
      callback(null);
    }
  },
});
