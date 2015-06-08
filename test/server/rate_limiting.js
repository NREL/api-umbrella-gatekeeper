'use strict';

require('../test_helper');

var _ = require('lodash'),
    async = require('async'),
    Factory = require('factory-lady'),
    fs = require('fs'),
    ippp = require('ipplusplus'),
    request = require('request'),
    timekeeper = require('timekeeper'),
    yaml = require('js-yaml');

describe('ApiUmbrellaGatekeper', function() {
  describe('rate limiting', function() {
    function headers(defaults, overrides) {
      var headersObj = _.extend(defaults, overrides);

      for(var header in headersObj) {
        if(headersObj[header] === null || headersObj[header] === undefined) {
          delete headersObj[header];
        }
      }

      return headersObj;
    }

    function itBehavesLikeRateLimitResponseHeaders(path, limit, headerOverrides) {
      it('returns rate limit counter headers in the response', function(done) {
        var options = {
          headers: headers({
            'X-Forwarded-For': this.ipAddress,
            'X-Api-Key': this.apiKey,
          }, headerOverrides),
        };

        request.get('http://localhost:9333' + path, options, function(error, response) {
          response.headers['x-ratelimit-limit'].should.eql(limit.toString());
          response.headers['x-ratelimit-remaining'].should.eql((limit - 1).toString());
          done();
        });
      });
    }

    function itBehavesLikeNoRateLimitResponseHeaders(path, limit, headerOverrides) {
      it('returns no rate limit counter headers in the response', function(done) {
        var options = {
          headers: headers({
            'X-Forwarded-For': this.ipAddress,
            'X-Api-Key': this.apiKey,
          }, headerOverrides),
        };

        request.get('http://localhost:9333' + path, options, function(error, response) {
          should.not.exist(response.headers['x-ratelimit-limit']);
          should.not.exist(response.headers['x-ratelimit-remaining']);
          done();
        });
      });
    }

    function itBehavesLikeApiKeyRateLimits(path, limit, headerOverrides, taskOptions) {
      it('allows up to the limit of requests and then begins rejecting requests', function(done) {
        var options = {
          headers: headers({
            'X-Forwarded-For': this.ipAddress,
            'X-Api-Key': this.apiKey,
          }, headerOverrides),
        };

        async.times(limit, function(index, asyncCallback) {
          request.get('http://localhost:9333' + path, options, function(error, response) {
            response.statusCode.should.eql(200);
            asyncCallback(null);
          });
        }.bind(this), function() {
          request.get('http://localhost:9333' + path, options, function(error, response) {
            response.statusCode.should.eql(429);
            done();
          });
        }.bind(this));
      });

      it('counts api keys differently', function(done) {
        var options = {
          headers: headers({
            'X-Forwarded-For': this.ipAddress,
            'X-Api-Key': this.apiKey,
          }, headerOverrides),
        };

        async.times(limit, function(index, asyncCallback) {
          request.get('http://localhost:9333' + path, options, function(error, response) {
            response.statusCode.should.eql(200);
            asyncCallback(null);
          });
        }.bind(this), function() {
          Factory.create('api_user', function(user) {
            options.headers['X-Api-Key'] = user.api_key;

            request.get('http://localhost:9333' + path, options, function(error, response) {
              response.statusCode.should.eql(200);
              done();
            });
          });
        });
      });

      if(taskOptions && taskOptions.noResponseHeadersTest) {
        itBehavesLikeNoRateLimitResponseHeaders(path, limit, headerOverrides);
      } else {
        itBehavesLikeRateLimitResponseHeaders(path, limit, headerOverrides);
      }
    }

    function itBehavesLikeIpRateLimits(path, limit, headerOverrides, taskOptions) {
      it('allows up to the limit of requests and then begins rejecting requests', function(done) {
        var options = {
          headers: headers({
            'X-Forwarded-For': this.ipAddress,
            'X-Api-Key': this.apiKey,
          }, headerOverrides),
        };

        async.times(limit, function(index, asyncCallback) {
          request.get('http://localhost:9333' + path, options, function(error, response) {
            response.statusCode.should.eql(200);
            asyncCallback(null);
          });
        }, function() {
          request.get('http://localhost:9333' + path, options, function(error, response) {
            response.statusCode.should.eql(429);
            done();
          });
        });
      });

      it('counts ip addresses differently', function(done) {
        var options = {
          headers: headers({
            'X-Forwarded-For': this.ipAddress,
            'X-Api-Key': this.apiKey,
          }, headerOverrides),
        };

        async.times(limit, function(index, asyncCallback) {
          request.get('http://localhost:9333' + path, options, function(error, response) {
            response.statusCode.should.eql(200);
            asyncCallback(null);
          });
        }, function() {
          global.autoIncrementingIpAddress = ippp.next(global.autoIncrementingIpAddress);
          options.headers['X-Forwarded-For'] = global.autoIncrementingIpAddress;

          request.get('http://localhost:9333' + path, options, function(error, response) {
            response.statusCode.should.eql(200);
            done();
          });
        }.bind(this));
      });

      if(taskOptions && taskOptions.noResponseHeadersTest) {
        itBehavesLikeNoRateLimitResponseHeaders(path, limit, headerOverrides);
      } else {
        itBehavesLikeRateLimitResponseHeaders(path, limit, headerOverrides);
      }
    }

    function itBehavesLikeUnlimitedRateLimits(path, limit, headerOverrides) {
      it('can exceed the limits and still accept requests', function(done) {
        var options = {
          headers: headers({
            'X-Api-Key': this.apiKey,
          }, headerOverrides),
        };

        async.times(limit + 1, function(index, asyncCallback) {
          request.get('http://localhost:9333' + path, options, function(error, response) {
            response.statusCode.should.eql(200);
            asyncCallback(null);
          });
        }.bind(this), function() {
          done();
        });
      });

      it('omits rate limit counter headers in the response', function(done) {
        var options = {
          headers: headers({
            'X-Api-Key': this.apiKey,
          }, headerOverrides),
        };

        request.get('http://localhost:9333' + path, options, function(error, response) {
          should.not.exist(response.headers['x-ratelimit-limit']);
          should.not.exist(response.headers['x-ratelimit-remaining']);
          done();
        });
      });
    }

    describe('single hourly limit', function() {
      shared.runServer({
        apiSettings: {
          rate_limits: [
            {
              duration: 60 * 60 * 1000, // 1 hour
              accuracy: 1 * 60 * 1000, // 1 minute
              limit_by: 'apiKey',
              limit: 10,
              distributed: true,
              response_headers: true,
            }
          ]
        }
      });

      itBehavesLikeApiKeyRateLimits('/hello', 10);

      it('rejects requests after the hourly limit has been exceeded', function(done) {
        timekeeper.freeze(new Date(2013, 1, 1, 1, 27, 0));
        async.times(10, function(index, asyncCallback) {
          request.get('http://localhost:9333/hello.xml?api_key=' + this.apiKey, function() {
            asyncCallback(null);
          });
        }.bind(this), function() {
          timekeeper.freeze(new Date(2013, 1, 1, 2, 26, 59));
          request.get('http://localhost:9333/hello.xml?api_key=' + this.apiKey, function(error, response, body) {
            response.statusCode.should.eql(429);
            body.should.include('<code>OVER_RATE_LIMIT</code>');

            timekeeper.reset();
            done();
          });
        }.bind(this));
      });

      it('allows requests again in the next hour after the rate limit has been exceeded', function(done) {
        timekeeper.freeze(new Date(2013, 1, 1, 1, 27, 0));
        async.times(11, function(index, asyncCallback) {
          request.get('http://localhost:9333/hello?api_key=' + this.apiKey, function() {
            asyncCallback(null);
          });
        }.bind(this), function() {
          timekeeper.freeze(new Date(2013, 1, 1, 2, 27, 0));
          request.get('http://localhost:9333/hello?api_key=' + this.apiKey, function(error, response, body) {
            response.statusCode.should.eql(200);
            body.should.eql('Hello World');

            timekeeper.reset();
            done();
          });
        }.bind(this));
      });

      it('resets rate limits on a rolling basis, so no more than the limit can be called within the past hour', function(done) {
        async.series([
          function(callback) {
            timekeeper.freeze(new Date(2013, 1, 2, 1, 43, 0));
            async.timesSeries(2, function(index, timesCallback) {
              request.get('http://localhost:9333/hello?api_key=' + this.apiKey, function(error, response) {
                response.statusCode.should.eql(200);
                timesCallback(null);
              });
            }.bind(this), callback);
          }.bind(this),
          function(callback) {
            timekeeper.freeze(new Date(2013, 1, 2, 2, 3, 0));
            async.timesSeries(3, function(index, timesCallback) {
              request.get('http://localhost:9333/hello?api_key=' + this.apiKey, function(error, response) {
                response.statusCode.should.eql(200);
                timesCallback(null);
              });
            }.bind(this), callback);
          }.bind(this),
          function(callback) {
            timekeeper.freeze(new Date(2013, 1, 2, 2, 42, 0));
            async.timesSeries(5, function(index, timesCallback) {
              request.get('http://localhost:9333/hello?api_key=' + this.apiKey, function(error, response) {
                response.statusCode.should.eql(200);
                timesCallback(null);
              });
            }.bind(this), callback);
          }.bind(this),
          function(callback) {
            timekeeper.freeze(new Date(2013, 1, 2, 2, 42, 0));
            async.timesSeries(1, function(index, timesCallback) {
              request.get('http://localhost:9333/hello?api_key=' + this.apiKey, function(error, response) {
                response.statusCode.should.eql(429);
                timesCallback(null);
              });
            }.bind(this), callback);
          }.bind(this),
          function(callback) {
            timekeeper.freeze(new Date(2013, 1, 2, 2, 43, 0));
            async.timesSeries(2, function(index, timesCallback) {
              request.get('http://localhost:9333/hello?api_key=' + this.apiKey, function(error, response) {
                response.statusCode.should.eql(200);
                timesCallback(null);
              });
            }.bind(this), callback);
          }.bind(this),
          function(callback) {
            timekeeper.freeze(new Date(2013, 1, 2, 2, 43, 0));
            async.timesSeries(1, function(index, timesCallback) {
              request.get('http://localhost:9333/hello?api_key=' + this.apiKey, function(error, response) {
                response.statusCode.should.eql(429);
                timesCallback(null);
              });
            }.bind(this), callback);
          }.bind(this),
          function(callback) {
            timekeeper.freeze(new Date(2013, 1, 2, 3, 2, 0));
            async.timesSeries(1, function(index, timesCallback) {
              request.get('http://localhost:9333/hello?api_key=' + this.apiKey, function(error, response) {
                response.statusCode.should.eql(429);
                timesCallback(null);
              });
            }.bind(this), callback);
          }.bind(this),
          function(callback) {
            timekeeper.freeze(new Date(2013, 1, 2, 3, 3, 0));
            async.timesSeries(3, function(index, timesCallback) {
              request.get('http://localhost:9333/hello?api_key=' + this.apiKey, function(error, response) {
                response.statusCode.should.eql(200);
                timesCallback(null);
              });
            }.bind(this), callback);
          }.bind(this),
          function(callback) {
            timekeeper.freeze(new Date(2013, 1, 2, 3, 3, 0));
            async.timesSeries(1, function(index, timesCallback) {
              request.get('http://localhost:9333/hello?api_key=' + this.apiKey, function(error, response) {
                response.statusCode.should.eql(429);
                timesCallback(null);
              });
            }.bind(this), callback);
          }.bind(this),
        ], function(error) {
          timekeeper.reset();
          done(error);
        });
      });

      it('allows rate limits to be changed live', function(done) {
        var config = require('api-umbrella-config').global();

        var url = 'http://localhost:9333/hello?api_key=' + this.apiKey;
        request.get(url, function(error, response) {
          response.headers['x-ratelimit-limit'].should.eql('10');

          var apiSettings = config.get('apiSettings');
          apiSettings.rate_limits[0].limit = 70;

          fs.writeFileSync(config.path, yaml.dump(config.getAll()));
          config.reload();

          request.get(url, function(error, response) {
            response.headers['x-ratelimit-limit'].should.eql('70');
            done();
          }.bind(this));
        }.bind(this));
      });
    });

    describe('multiple limits', function() {
      shared.runServer({
        apiSettings: {
          rate_limits: [
            {
              duration: 10 * 1000, // 10 second
              accuracy: 1000, // 1 second
              limit_by: 'apiKey',
              limit: 3,
              response_headers: true,
            }, {
              duration: 60 * 60 * 1000, // 1 hour
              accuracy: 1 * 60 * 1000, // 1 minute
              limit_by: 'apiKey',
              limit: 10,
              response_headers: false,
              distributed: true,
            }
          ]
        }
      });

      it('does not count excess queries in the smaller time window against the larger time window', function(done) {
        timekeeper.freeze(new Date(2013, 1, 1, 1, 27, 43));
        async.times(15, function(index, asyncCallback) {
          request.get('http://localhost:9333/hello?api_key=' + this.apiKey, function() {
            asyncCallback(null);
          });
        }.bind(this), function() {
          timekeeper.freeze(new Date(2013, 1, 1, 1, 27, 53));

          request.get('http://localhost:9333/hello?api_key=' + this.apiKey, function(error, response, body) {
            response.statusCode.should.eql(200);
            body.should.eql('Hello World');

            timekeeper.reset();
            done();
          });
        }.bind(this));
      });

      describe('sets the response header counters from the limit that has that enabled', function() {
        itBehavesLikeRateLimitResponseHeaders('/hello', 3);
      });

      it('counts down the response header counters, but never returns negative', function(done) {
        var limit = 3;
        async.timesSeries(limit + 2, function(index, asyncCallback) {
          request.get('http://localhost:9333/hello?api_key=' + this.apiKey, function(error, response) {
            response.headers['x-ratelimit-limit'].should.eql(limit.toString());

            var remaining = limit - 1 - index;
            if(remaining < 0) {
              remaining = 0;
            }

            response.headers['x-ratelimit-remaining'].should.eql(remaining.toString());

            asyncCallback(null);
          });
        }.bind(this), function() {
          done();
        });
      });
    });

    describe('multiple limits with response headers being the non-first limit', function() {
      shared.runServer({
        apiSettings: {
          rate_limits: [
            {
              duration: 10 * 1000, // 10 second
              accuracy: 1000, // 1 second
              limit_by: 'apiKey',
              limit: 3,
              response_headers: false,
            }, {
              duration: 60 * 60 * 1000, // 1 hour
              accuracy: 1 * 60 * 1000, // 1 minute
              limit_by: 'apiKey',
              limit: 10,
              response_headers: true,
              distributed: true,
            }
          ]
        }
      });

      it('returns rate limit headers for each request, even if the first limit has been exceeded', function(done) {
        async.timesSeries(15, function(index, asyncCallback) {
          request.get('http://localhost:9333/hello.xml?api_key=' + this.apiKey, function(error, response) {
            response.headers['x-ratelimit-limit'].should.eql('10');
            asyncCallback(null);
          });
        }.bind(this), done);
      });
    });

    describe('multiple limits exceeding the non-first limit', function() {
      shared.runServer({
        apiSettings: {
          rate_limits: [
            {
              duration: 10 * 1000, // 10 second
              accuracy: 1000, // 1 second
              limit_by: 'apiKey',
              limit: 10,
              response_headers: false,
            }, {
              duration: 60 * 60 * 1000, // 1 hour
              accuracy: 1 * 60 * 1000, // 1 minute
              limit_by: 'apiKey',
              limit: 3,
              response_headers: true,
              distributed: true,
            }
          ]
        }
      });

      itBehavesLikeApiKeyRateLimits('/hello', 3);
    });

    describe('ip based rate limits', function() {
      shared.runServer({
        apiSettings: {
          rate_limits: [
            {
              duration: 60 * 60 * 1000, // 1 hour
              accuracy: 1 * 60 * 1000, // 1 minute
              limit_by: 'ip',
              limit: 5,
              distributed: true,
              response_headers: true,
            }
          ]
        },
      });

      itBehavesLikeIpRateLimits('/hello', 5);
    });

    describe('api key limits but no api key required', function() {
      shared.runServer({
        apiSettings: {
          rate_limits: [
            {
              duration: 60 * 60 * 1000, // 1 hour
              accuracy: 1 * 60 * 1000, // 1 minute
              limit_by: 'apiKey',
              limit: 5,
              distributed: true,
              response_headers: true,
            },
            {
              duration: 60 * 60 * 1000, // 1 hour
              accuracy: 1 * 60 * 1000, // 1 minute
              limit_by: 'ip',
              limit: 7,
              distributed: true,
              response_headers: false,
            },
          ]
        },
        apis: [
          {
            frontend_host: 'localhost',
            backend_host: 'example.com',
            url_matches: [
              {
                frontend_prefix: '/info/no-keys-default',
                backend_prefix: '/info/no-keys-default',
              }
            ],
            settings: {
              disable_api_key: true,
            },
          },
          {
            frontend_host: 'localhost',
            backend_host: 'example.com',
            url_matches: [
              {
                frontend_prefix: '/info/no-keys-ip-fallback',
                backend_prefix: '/info/no-keys-ip-fallback',
              }
            ],
            settings: {
              disable_api_key: true,
              anonymous_rate_limit_behavior: 'ip_fallback',
            },
          },
          {
            frontend_host: 'localhost',
            backend_host: 'example.com',
            url_matches: [
              {
                frontend_prefix: '/info/no-keys-ip-only',
                backend_prefix: '/info/no-keys-ip-only',
              }
            ],
            settings: {
              disable_api_key: true,
              anonymous_rate_limit_behavior: 'ip_only',
            },
          },
        ],
      });

      describe('default/blank anonymous rate limit behavior', function() {
        describe('api key not required but still given - uses api key limit', function() {
          itBehavesLikeApiKeyRateLimits('/info/no-keys-default', 5);
        });

        describe('api key ommitted - uses api key limit as ip limit', function() {
          itBehavesLikeIpRateLimits('/info/no-keys-default', 5, {
            'X-Api-Key': undefined,
          });
        });
      });

      describe('ip fallback anonymous rate limit behavior', function() {
        describe('api key not required but still given - uses api key limit', function() {
          itBehavesLikeApiKeyRateLimits('/info/no-keys-ip-fallback', 5);
        });

        describe('api key ommitted - uses api key limit as ip limit', function() {
          itBehavesLikeIpRateLimits('/info/no-keys-ip-fallback', 5, {
            'X-Api-Key': undefined,
          });
        });
      });

      describe('ip only anonymous rate limit behavior', function() {
        describe('api key not required but still given - uses api key limit', function() {
          itBehavesLikeApiKeyRateLimits('/info/no-keys-ip-only', 5);
        });

        describe('api key ommitted - ignores api key limit and only uses ip limit', function() {
          itBehavesLikeIpRateLimits('/info/no-keys-ip-only', 7, {
            'X-Api-Key': undefined,
          }, {
            noResponseHeadersTest: true,
          });
        });
      });
    });

    describe('ip limits when api key supplied but no api key required', function() {
      shared.runServer({
        apiSettings: {
          rate_limits: [
            {
              duration: 60 * 60 * 1000, // 1 hour
              accuracy: 1 * 60 * 1000, // 1 minute
              limit_by: 'ip',
              limit: 5,
              distributed: true,
              response_headers: true,
            },
            {
              duration: 60 * 60 * 1000, // 1 hour
              accuracy: 1 * 60 * 1000, // 1 minute
              limit_by: 'apiKey',
              limit: 7,
              distributed: true,
              response_headers: false,
            },
          ]
        },
        apis: [
          {
            frontend_host: 'localhost',
            backend_host: 'example.com',
            url_matches: [
              {
                frontend_prefix: '/info/ip-limit-default',
                backend_prefix: '/info/ip-limit-default',
              }
            ],
            settings: {
              disable_api_key: true,
            },
          },
          {
            frontend_host: 'localhost',
            backend_host: 'example.com',
            url_matches: [
              {
                frontend_prefix: '/info/ip-limit-all',
                backend_prefix: '/info/ip-limit-all',
              }
            ],
            settings: {
              disable_api_key: true,
              authenticated_rate_limit_behavior: 'all',
            },
          },
          {
            frontend_host: 'localhost',
            backend_host: 'example.com',
            url_matches: [
              {
                frontend_prefix: '/info/ip-limit-api-key-only',
                backend_prefix: '/info/ip-limit-api-key-only',
              }
            ],
            settings: {
              disable_api_key: true,
              authenticated_rate_limit_behavior: 'api_key_only',
            },
          },
        ],
      });

      describe('default/blank authenticated rate limit behavior', function() {
        describe('api key not required but still given - uses first, smaller limit (ip)', function() {
          itBehavesLikeIpRateLimits('/info/ip-limit-all', 5);
        });

        describe('api key ommitted - uses ip limit', function() {
          itBehavesLikeIpRateLimits('/info/ip-limit-default', 5, {
            'X-Api-Key': undefined,
          });
        });
      });

      describe('all limits authenticated rate limit behavior', function() {
        describe('api key not required but still given - uses first, smaller limit (ip)', function() {
          itBehavesLikeIpRateLimits('/info/ip-limit-all', 5);
        });

        describe('api key ommitted - uses ip limit', function() {
          itBehavesLikeIpRateLimits('/info/ip-limit-all', 5, {
            'X-Api-Key': undefined,
          });
        });
      });

      describe('api key only rate limit behavior', function() {
        describe('api key not required but still given - uses api key limit', function() {
          itBehavesLikeApiKeyRateLimits('/info/ip-limit-api-key-only', 7, {}, {
            noResponseHeadersTest: true,
          });
        });

        describe('api key ommitted - uses ip limit', function() {
          itBehavesLikeIpRateLimits('/info/ip-limit-api-key-only', 5, {
            'X-Api-Key': undefined,
          });
        });
      });
    });

    describe('unlimited rate limits', function() {
      shared.runServer({
        apiSettings: {
          rate_limit_mode: 'unlimited',
          rate_limits: [
            {
              duration: 60 * 60 * 1000, // 1 hour
              accuracy: 1 * 60 * 1000, // 1 minute
              limit_by: 'apiKey',
              limit: 5,
              response_headers: true,
            },
            {
              duration: 60 * 60 * 1000, // 1 hour
              accuracy: 1 * 60 * 1000, // 1 minute
              limit_by: 'ip',
              limit: 5,
            }
          ]
        },
      });

      itBehavesLikeUnlimitedRateLimits('/hello', 5);

      describe('user with settings object present, but null rate_limit mode', function() {
        beforeEach(function setupApiUser(done) {
          Factory.create('api_user', {
            settings: {
              rate_limit_mode: null,
            }
          }, function(user) {
            this.apiKey = user.api_key;
            done();
          }.bind(this));
        });

        itBehavesLikeUnlimitedRateLimits('/hello', 5);
      });
    });

    describe('api specific limits', function() {
      shared.runServer({
        apiSettings: {
          rate_limits: [
            {
              duration: 60 * 60 * 1000, // 1 hour
              accuracy: 1 * 60 * 1000, // 1 minute
              limit_by: 'apiKey',
              limit: 5,
              distributed: true,
              response_headers: true,
            }
          ]
        },
        apis: [
          {
            frontend_host: 'localhost',
            backend_host: 'example.com',
            url_matches: [
              {
                frontend_prefix: '/info/lower/',
                backend_prefix: '/info/lower/',
              }
            ],
            settings: {
              rate_limits: [
                {
                  duration: 60 * 60 * 1000, // 1 hour
                  accuracy: 1 * 60 * 1000, // 1 minute
                  limit_by: 'apiKey',
                  limit: 3,
                  distributed: true,
                  response_headers: true,
                }
              ],
            },
            sub_settings: [
              {
                http_method: 'any',
                regex: '^/info/lower/sub-higher',
                settings: {
                  rate_limits: [
                    {
                      duration: 60 * 60 * 1000, // 1 hour
                      accuracy: 1 * 60 * 1000, // 1 minute
                      limit_by: 'apiKey',
                      limit: 7,
                      distributed: true,
                      response_headers: true,
                    }
                  ],
                },
              },
            ],
          },
          {
            frontend_host: 'localhost',
            backend_host: 'example.com',
            url_matches: [
              {
                frontend_prefix: '/',
                backend_prefix: '/',
              }
            ],
          },
        ],
      });

      describe('api with lower rate limits', function() {
        itBehavesLikeApiKeyRateLimits('/info/lower/', 3);
      });

      describe('sub-settings within an api that give higher rate limits', function() {
        itBehavesLikeApiKeyRateLimits('/info/lower/sub-higher', 7);
      });

      describe('api with no rate limit settings uses the defaults', function() {
        itBehavesLikeApiKeyRateLimits('/hello', 5);
      });

      describe('user with empty rate limits settings array', function() {
        beforeEach(function setupApiUser(done) {
          Factory.create('api_user', {
            settings: {
              rate_limit_mode: null,
              rate_limits: [],
            }
          }, function(user) {
            this.apiKey = user.api_key;
            done();
          }.bind(this));
        });

        itBehavesLikeApiKeyRateLimits('/info/lower/', 3);
      });

      describe('changing rate limits', function() {
        it('allows rate limits to be changed live', function(done) {
          var config = require('api-umbrella-config').global();

          var url = 'http://localhost:9333/info/lower/?api_key=' + this.apiKey;
          request.get(url, function(error, response) {
            response.headers['x-ratelimit-limit'].should.eql('3');

            var apis = config.get('apis');
            apis[0].settings.rate_limits[0].limit = 80;

            fs.writeFileSync(config.path, yaml.dump(config.getAll()));
            config.reload();

            request.get(url, function(error, response) {
              response.headers['x-ratelimit-limit'].should.eql('80');
              done();
            }.bind(this));
          }.bind(this));
        });
      });
    });

    describe('user specific limits', function() {
      shared.runServer({
        apis: [
          {
            frontend_host: 'localhost',
            backend_host: 'example.com:8080',
            url_matches: [
              {
                frontend_prefix: '/info/port',
                backend_prefix: '/info/port'
              }
            ]
          },
          {
            frontend_host: 'localhost',
            backend_host: 'example.com',
            url_matches: [
              {
                frontend_prefix: '/',
                backend_prefix: '/'
              }
            ]
          }
        ],
        apiSettings: {
          rate_limits: [
            {
              duration: 60 * 60 * 1000, // 1 hour
              accuracy: 1 * 60 * 1000, // 1 minute
              limit_by: 'apiKey',
              limit: 5,
              distributed: true,
              response_headers: true,
            }
          ]
        }
      });

      describe('ip based limits', function() {
        beforeEach(function setupApiUser(done) {
          Factory.create('api_user', { throttle_by_ip: true }, function(user) {
            this.apiKey = user.api_key;
            done();
          }.bind(this));
        });

        itBehavesLikeIpRateLimits('/hello', 5);
      });

      describe('unlimited rate limits', function() {
        beforeEach(function setupApiUser(done) {
          Factory.create('api_user', {
            settings: {
              rate_limit_mode: 'unlimited'
            }
          }, function(user) {
            this.apiKey = user.api_key;
            done();
          }.bind(this));
        });

        itBehavesLikeUnlimitedRateLimits('/hello', 5);
      });

      describe('custom rate limits', function() {
        beforeEach(function setupApiUser(done) {
          Factory.create('api_user', {
            settings: {
              rate_limits: [
                {
                  duration: 60 * 60 * 1000, // 1 hour
                  accuracy: 1 * 60 * 1000, // 1 minute
                  limit_by: 'apiKey',
                  limit: 10,
                  distributed: true,
                  response_headers: true,
                  backend_host: 'example.com',
                }
              ]
            }
          }, function(user) {
            this.user = user;
            this.apiKey = user.api_key;
            done();
          }.bind(this));
        });

        itBehavesLikeApiKeyRateLimits('/hello', 10);

        it('allows rate limits to be changed live', function(done) {
          var url = 'http://localhost:9333/hello?api_key=' + this.apiKey;
          request.get(url, function(error, response) {
            response.headers['x-ratelimit-limit'].should.eql('10');

            this.user.settings.rate_limits[0].limit = 90;
            this.user.markModified('settings');
            this.user.save(function() {
              request.get(url, function(error, response) {
                response.headers['x-ratelimit-limit'].should.eql('90');
                done();
              }.bind(this));
            }.bind(this));
          }.bind(this));
        });

        // Different backend host has different limits
        itBehavesLikeApiKeyRateLimits('/info/port', 5);
      });
    });
  });
});
