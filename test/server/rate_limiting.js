'use strict';

require('../test_helper');

var _ = require('lodash'),
    async = require('async'),
    config = require('../../lib/config'),
    ippp = require('ipplusplus'),
    timekeeper = require('timekeeper');

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

    function itBehavesLikeApiKeyRateLimits(path, limit, headerOverrides) {
      it('allows up to the limit of requests and then begins rejecting requests', function(done) {
        var options = {
          headers: headers({
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

      itBehavesLikeRateLimitResponseHeaders(path, limit, headerOverrides);
    }

    function itBehavesLikeIpRateLimits(path, limit, headerOverrides) {
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
          this.ipAddress = ippp.next(this.ipAddress);
          options.headers['X-Forwarded-For'] = this.ipAddress;

          request.get('http://localhost:9333' + path, options, function(error, response) {
            response.statusCode.should.eql(200);
            done();
          });
        }.bind(this));
      });

      itBehavesLikeRateLimitResponseHeaders(path, limit, headerOverrides);
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

      it('allows rate limits to be changed live', function(done) {
        var url = 'http://localhost:9333/hello?api_key=' + this.apiKey;
        request.get(url, function(error, response) {
          response.headers['x-ratelimit-limit'].should.eql('10');

          var apiSettings = config.get('apiSettings');
          apiSettings.rate_limits[0].limit = 70;

          config.updateRuntime({
            apiSettings: apiSettings,
          });

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
            }
          ]
        },
        apis: [
          {
            frontend_host: 'localhost',
            backend_host: 'example.com',
            url_matches: [
              {
                frontend_prefix: '/info/no-keys',
                backend_prefix: '/info/no-keys',
              }
            ],
            settings: {
              disable_api_key: true,
            },
          },
        ],
      });

      describe('api key not required but still given', function() {
        itBehavesLikeApiKeyRateLimits('/info/no-keys', 5);
      });

      describe('api key ommitted', function() {
        itBehavesLikeIpRateLimits('/info/no-keys', 5, {
          'X-Api-Key': undefined,
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

      describe('changing rate limits', function() {
        it('allows rate limits to be changed live', function(done) {
          var url = 'http://localhost:9333/info/lower/?api_key=' + this.apiKey;
          request.get(url, function(error, response) {
            response.headers['x-ratelimit-limit'].should.eql('3');

            var apis = config.get('apis');
            apis[0].settings.rate_limits[0].limit = 80;

            config.updateRuntime({
              apis: apis,
            });

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
        beforeEach(function(done) {
          Factory.create('api_user', { throttle_by_ip: true }, function(user) {
            this.apiKey = user.api_key;
            done();
          }.bind(this));
        });

        itBehavesLikeIpRateLimits('/hello', 5);
      });

      describe('unlimited rate limits', function() {
        beforeEach(function(done) {
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
        beforeEach(function(done) {
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
      });
    });
  });
});
