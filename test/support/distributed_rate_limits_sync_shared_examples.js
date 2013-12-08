'use strict';

require('../test_helper');

var _ = require('lodash'),
    config = require('../../lib/config'),
    DistributedRateLimitsSync = require('../../lib/distributed_rate_limits_sync').DistributedRateLimitsSync;

_.merge(global.shared, {
  runDistributedRateLimitsSync: function(configOverrides) {
    beforeEach(function(done) {
      config.reset();

      if(configOverrides) {
        config.updateRuntime({ apiUmbrella: configOverrides });
      }

      this.distributedRateLimitsSync = new DistributedRateLimitsSync(done);
    });

    afterEach(function(done) {
      this.distributedRateLimitsSync.close(done);
    });
  },
});
