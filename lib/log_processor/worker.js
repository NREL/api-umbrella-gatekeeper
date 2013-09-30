'use strict';

var _ = require('underscore'),
    async = require('async'),
    config = require('../config'),
    ElasticSearchClient = require('elasticsearchclient'),
    events = require('events'),
    fs = require('fs'),
    Handler = require('./handler').Handler,
    logger = require('../logger'),
    path = require('path'),
    util = require('util');

var Worker = function() {
  this.initialize.apply(this, arguments);
};

module.exports.Worker = Worker;

util.inherits(Worker, events.EventEmitter);
_.extend(Worker.prototype, {
  combining: {},

  initialize: function() {
    async.series([
      this.connectElasticsearch.bind(this),
      this.startBeanstalkHandler.bind(this),
    ], this.handleConnections.bind(this));
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

  startBeanstalkHandler: function(asyncReadyCallback) {
    this.beanstalkHandler = new Handler(this);
    asyncReadyCallback(null);
  },

  handleConnections: function(error) {
    if(error) {
      logger.error(error);
      process.exit(1);
      return false;
    }

    this.emit('ready');
  },

  close: function(callback) {
    if(this.beanstalkHandler) {
      this.beanstalkHandler.close();
    }

    if(callback) {
      callback(null);
    }
  },
});
