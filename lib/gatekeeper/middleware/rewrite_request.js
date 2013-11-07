'use strict';

var _ = require('lodash'),
    url = require('url');

var RewriteRequest = function() {
  this.initialize.apply(this, arguments);
};

_.extend(RewriteRequest.prototype, {
  initialize: function() {
  },

  handleRequest: function(request, response, next) {
    var urlParts = url.parse(request.url, true);

    this.normalizeApiKey(request, urlParts);
    this.setUserId(request, urlParts);
    this.setRolesHeader(request, urlParts);
    this.setHost(request);
    this.appendQueryString(request, urlParts);
    this.setHeaders(request);
    this.setHttpBasicAuth(request);

    if(urlParts.changed) {
      delete urlParts.search;
      request.url = url.format(urlParts);
    }

    this.urlRewrites(request);

    next();
  },

  normalizeApiKey: function(request, urlParts) {
    // Standardize how the api key is passed to backends, so backends only have
    // to check one place (the HTTP header).
    request.headers['X-Api-Key'] = request.apiUmbrellaGatekeeper.apiKey;

    // Strip the api key from the query string, so better HTTP caching can be
    // performed (so the URL won't vary for each user).
    if(urlParts.query.api_key) {
      if(!urlParts.hosts || urlParts.host.indexOf('whitehouse.gov') === -1) {
        delete urlParts.query.api_key;
        urlParts.changed = true;
      }
    }
  },

  setUserId: function(request) {
    delete request.headers['x-api-user-id'];
    if(request.apiUmbrellaGatekeeper.user) {
      request.headers['X-Api-User-Id'] = request.apiUmbrellaGatekeeper.user._id.toString();
    }
  },

  setRolesHeader: function(request) {
    delete request.headers['x-api-roles'];
    if(request.apiUmbrellaGatekeeper.user && request.apiUmbrellaGatekeeper.user.roles && request.apiUmbrellaGatekeeper.user.roles.length > 0) {
      request.headers['X-Api-Roles'] = request.apiUmbrellaGatekeeper.user.roles.join(',');
    }
  },

  setHost: function(request) {
    var host = request.apiUmbrellaGatekeeper.matchedApi.backend_host;
    if(host) {
      request.headers.Host = host;
    }
  },

  appendQueryString: function(request, urlParts) {
    var append = request.apiUmbrellaGatekeeper.settings.cache.append_query_object;
    if(append) {
      _.extend(urlParts.query, append);
      urlParts.changed = true;
    }
  },

  setHeaders: function(request) {
    var headers = request.apiUmbrellaGatekeeper.settings.headers;
    if(headers) {
      for(var i = 0, len = headers.length; i < len; i++) {
        var header = headers[i];
        request.headers[header.key] = header.value;
      }
    }
  },

  setHttpBasicAuth: function(request) {
    var auth = request.apiUmbrellaGatekeeper.settings.http_basic_auth;
    if(auth) {
      var base64 = (new Buffer(auth, 'ascii')).toString('base64');
      request.headers.Authorization = 'Basic ' + base64;
    }
  },

  urlRewrites: function(request) {
    var rewrites = request.apiUmbrellaGatekeeper.matchedApi.rewrites;
    if(rewrites) {
      for(var i = 0, len = rewrites.length; i < len; i++) {
        var rewrite = rewrites[i];
        if(rewrite.http_method === 'any' || rewrite.http_method === request.method) {
          if(rewrite.matcher_type === 'route') {
            var match = rewrite.frontend_pattern.match(request.url);
            if(match) {
              request.url = rewrite.backend_template(match.namedParams);
            }
          } else if(rewrite.matcher_type === 'regex') {
            request.url = request.url.replace(rewrite.frontend_regex, rewrite.backend_replacement);
          }
        }
      }
    }
  },
});

module.exports = function rewriteRequest() {
  var middleware = new RewriteRequest();

  return function(request, response, next) {
    middleware.handleRequest(request, response, next);
  };
};
