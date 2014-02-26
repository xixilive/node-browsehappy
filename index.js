var fs = require("fs"),
    Promise = require("bluebird"),
    request = require("request"),
    browserData = require("./browserData.json");

var cache = null; // created in _loadCache
var cacheFile = __dirname + "/.cache";
var log = function (msg) {
    // console.log(msg);
};

var BrowseHappy = {
    Data: browserData
};

BrowseHappy._ready = Promise.defer();
BrowseHappy.ready = BrowseHappy._ready.promise;

BrowseHappy.init = function () {
    var self = this;
    self._loadCache()
        .then(function (cacheLoadedFromFile) {
            return self._refreshCache(!cacheLoadedFromFile);
        })
        .then(function () {
            return self._parseCache();
        })
        .then(function () {
            return self._ready.resolve(true);
        });
};

BrowseHappy.setLogger = function (fn) {
    log = fn;
};

BrowseHappy.getBrowserData = function (id) {
    var data = this.Data;
    if (!id) {
        return data;
    }
    for (var i = 0, l = data.length; i < l; i++) {
        if (data[i].id === id) {
            return data[i];
        }
    }
    return null;
};

BrowseHappy.getLatestVersion = function (id) {
    return this.getBrowserData(id).latestVersion;
};

BrowseHappy._normalizeVersion = function (normalized, str) {
    if (normalized === 1) {
        return str.match(/^[0-9]+/g)[0];
    } else if (normalized === 1.5) {
        var m = str.match(/^([0-9]+)\.([0-9]+)/);
        return m[1] + (m[2] !== "0" ? "." + m[2] : "");
    } else if (normalized === 2) {
        return str.match(/^[0-9]+\.[0-9]+/g)[0];
    } else {
        return str;
    }
};

BrowseHappy._parseCache = function () {
    // parse all objects in cache
    this.Data.forEach(function (browserData) {
        cache[browserData.id].forEach(function (str) {
            var m = str.match(/latest[\s_]release[\s_]version = ([\S]+)( [\S]+)?/g);
            if (!m) {
                throw new Error("failed to parse data for " + browserData.id);
            }
            
            var s = m[0].split(" = ")[1];
            s = s.match(/[\.0-9]+/g);
            
            var version = this._normalizeVersion(browserData.normalized, s[0]);
            browserData.latestVersion = version;
        }, this);
    }, this);
};

BrowseHappy._loadCache = function () {
    var defer = Promise.defer(),
        data = this.Data;

    // construct empty cache
    cache = {};
    cache._fetched = null;
    for (var i = 0, l = data.length; i < l; i++) {
        cache[data[i].id] = null;
    }

    // try to load cache from file
    fs.readFile(cacheFile, function (err, data) {
        if (err) {
            // false means _loadCache wasn't able to read the cache file
            log("failed to read cacheFile: " + err);
            return defer.resolve(false);
        }
        cache = JSON.parse(data);
        log("cache loaded from cacheFile");
        defer.resolve(true);
    });

    return defer.promise;
};

BrowseHappy._normalizeResponse = function (response) {
    var normalized = [];
    var pages = response.query.pages;
    Object.keys(pages).forEach(function (key) {
        pages[key].revisions.forEach(function (revision) {
            normalized.push(revision["*"]);
        });
    });
    return normalized;
};

BrowseHappy._refreshCache = function (forceRefresh) {
    var self = this,
        currentDay = new Date().toISOString().substring(0, 10);

    if (!forceRefresh && cache._fetched === currentDay) {
        log("cache is current");
        return Promise.resolve();
    }

    var promiseArr = this.Data.map(function (browserData) {
        var defer = Promise.defer();

        // build the url for wikipedia API - http://www.mediawiki.org/wiki/API:Main_page
        var url = "http://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&format=json&titles=Template:Latest_stable_software_release/";
        url += browserData.wikipedia;

        // make a request to api
        request(url, function (error, response, body) {
            if (error) {
                log("cache request " + browserData.id + " - " + error);
                return defer.reject(error);
            }
            if (response.statusCode != 200) {
                log("cache request " + browserData.id + " - " + response.statusCode);
                return defer.reject(new Error("wikipedia service returned " + response.statusCode));
            }
            log("cache request " + browserData.id + " - OK");

            // normalize the wikipedia response
            var responseJson = self._normalizeResponse(JSON.parse(body));

            // store to cache
            cache[browserData.id] = responseJson;

            defer.resolve();
        });

        return defer.promise;
    }, this);

    // after all requests, save the cache
    return Promise.all(promiseArr).then(function () {
        var defer = Promise.defer();
        // save current day
        cache._fetched = currentDay;
        log("cache was refreshed");
        // save cache to disk
        fs.writeFile(cacheFile, JSON.stringify(cache, null, 4), function () {
            // doesn't matter if cache is saved, or not
            log("cache was saved");
            defer.resolve();
        });
        return defer.promise;
    });
};

BrowseHappy.init();
module.exports = BrowseHappy;
