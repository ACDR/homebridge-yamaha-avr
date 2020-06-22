// This whole file is only need as long the pull request of yamaha-nodejs is accepted see:
// https://github.com/PSeitz/yamaha-nodejs/pull/34
var Promise = require("bluebird");
var debug = require('debug')('Yamaha-nodejs');
var xml2js = Promise.promisifyAll(require("xml2js"));

var request = Promise.promisify(require("request"));
Promise.promisifyAll(request);


function Yamaha() {}
Yamaha.prototype.getAvailableFeatures = function() {
var self = this;
  return self.getSystemConfig().then(function(info) {
      var features = [];
      var featuresXML = info.YAMAHA_AV.System[0].Config[0].Feature_Existence[0];
      debug("getAvailableFeatures",JSON.stringify(info, null, 2));
      for (var prop in featuresXML) {
          // Only return zones that the receiver supports
          if (! prop.includes('one') && featuresXML[prop].includes('1')) {
              features.push(prop);
          }
      }
      return features;
  });
};

module.exports = Yamaha;
