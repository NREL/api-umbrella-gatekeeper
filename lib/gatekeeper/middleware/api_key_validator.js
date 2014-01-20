'use strict';

var _ = require('lodash'),
    ApiUser = require('../../models/api_user'),
    async = require('async'),
    config = require('../../config'),
    logger = require('../../logger'),
    mergeOverwriteArrays = require('object-extend'),
    utils = require('../utils');

var ApiKeyValidatorRequest = function() {
  this.initialize.apply(this, arguments);
};

_.extend(ApiKeyValidatorRequest.prototype, {
  initialize: function(validator, request, response, next) {
    this.validator = validator;
    this.request = request;
    this.response = response;
    this.next = next;

    var apiKey = this.resolveApiKey();
    if(apiKey) {
      request.apiUmbrellaGatekeeper.apiKey = apiKey;

      // FIXME: We're seeing mongo dropped connections on one of our servers
      // that's erroneously leading to bad api key errors. This seems sporadic
      // and related to mongo dropping connections:
      // https://support.mongolab.com/entries/23009358-handling-dropped-connections-on-windows-azure
      //
      // For now, let's try retrying the user lookup several times on failure
      // to allow the chance for the mongo connection to re-establish.
      var retriesCount = 0;
      var retriesError;
      var retriesUser;
      async.doWhilst(
        function(callback) {
          ApiUser.findOne({ api_key: request.apiUmbrellaGatekeeper.apiKey }, function(error, user) {
            retriesError = error;
            if(error) {
              retriesCount++;
              logger.warning('MongoDB find user error (retrying... PID: ' + process.pid + ' retry: ' + retriesCount + '): ', error);
              setTimeout(callback, 50); // Retry in 50ms.
            } else {
              retriesUser = user;
              callback();
            }
          });
        }.bind(this), function() {
          // Keep retrying while there's an error for a while.
          return (retriesError && retriesCount < 100);
        }, function(error) {
          if(retriesCount > 0) {
            logger.warning('User afer retry ' + retriesCount + ': ', !!retriesUser);
          }

          this.handleUser(request, error, retriesUser);
        }.bind(this));
    } else {
      if(request.apiUmbrellaGatekeeper.settings && request.apiUmbrellaGatekeeper.settings.disable_api_key) {
        next();
      } else {
        utils.errorHandler(this.request, this.response, 'api_key_missing');
      }
    }
  },

  resolveApiKey: function() {
    var apiKey;
    for(var i = 0, len = this.validator.apiKeyMethods.length; i < len; i++) {
      switch(this.validator.apiKeyMethods[i]) {
      case 'header':
        apiKey = this.request.headers['x-api-key'];
        break;
      case 'getParam':
        apiKey = this.request.query.api_key;
        break;
      case 'basicAuthUsername':
        apiKey = this.request.basicAuthUsername;
        break;
      }

      if(apiKey) {
        break;
      }
    }

    return apiKey;
  },

  handleUser: function(request, error, user) {
    if(error) {
      logger.error('Failed to find user: ', error);
    }

    if(user) {
      if(!user.disabled_at) {
        this.request.apiUmbrellaGatekeeper.user = user;

        if(user.settings) {
          mergeOverwriteArrays(request.apiUmbrellaGatekeeper.settings, user.settings);
        }

        this.next();
      } else {
        utils.errorHandler(this.request, this.response, 'api_key_disabled');
      }
    } else {
      utils.errorHandler(this.request, this.response, 'api_key_invalid');
    }
  },
});

var ApiKeyValidator = function() {
  this.initialize.apply(this, arguments);
};

_.extend(ApiKeyValidator.prototype, {
  initialize: function() {
    this.apiKeyMethods = config.get('proxy.apiKeyMethods');
  },

  handleRequest: function(request, response, next) {
    new ApiKeyValidatorRequest(this, request, response, next);
  },
});

module.exports = function apiKeyValidator() {
  var middleware = new ApiKeyValidator();

  return function(request, response, next) {
    middleware.handleRequest(request, response, next);
  };
};
