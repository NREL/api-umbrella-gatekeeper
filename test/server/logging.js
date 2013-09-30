'use strict';

require('../test_helper');

var config = require('../../lib/config'),
    ElasticSearchClient = require('elasticsearchclient'),
    moment = require('moment');

describe('logging', function() {
  before(function() {
    this.elasticSearch = new ElasticSearchClient(config.get('elasticsearch'));
  });

  shared.runServer({
    apis: [
      {
        'frontend_host': 'localhost',
        'backend_host': 'example.com',
        '_id': 'default',
        'url_matches': [
          {
            'frontend_prefix': '/rewritten/info/',
            'backend_prefix': '/info/'
          }
        ]
      },
    ],
  });

  it('logs the ', function(done) {
    this.timeout(30000);
    var randomInput = Math.random().toString();
    var url =  'http://localhost:9333/rewritten/info/foo?input=' + randomInput;
    request.get(url + '&api_key=' + this.apiKey, function(error, response, body) {
      console.info('BODY: ', body);
      response.statusCode.should.eql(200);
      var index = 'api-umbrella-logs-' + moment().format('YYYY-MM');
      var query = {
        sort: [
          { 'request_at': 'desc' },
        ],
        from: 0,
        size: 1,
        query: {
          term: {
            request_url: url,
          },
        },
      };

      var interval = setInterval(function() {
        console.info('Searching...');
        this.elasticSearch.search(index, 'log', query, function(error, data) {
          var hits = JSON.parse(data).hits.hits;
          if(hits.length > 0) {
            var fields = hits[0]._source;
            fields.request_url.should.eql(url);

            clearInterval(interval);
            done();
          }
        });
      }.bind(this), 50);
    }.bind(this));
  });
});
