var express = require('express');
var app = express();
var path = require('path');
var fs = require('fs');

var EXAMPLE_PATH = process.env.EXAMPLE_PATH;
var PORT = process.env.PORT;

var example_root = path.join(EXAMPLE_PATH, 'examples');
var playground_root = path.resolve('playground');
var cache_root = path.resolve('cache');
var local_root = path.resolve('local_builds');

app.get('/', function (req, res) {
  res.send('Hello World!');
});

var flatCache = require('flat-cache');
var cache = flatCache.load('ext_api_cache', cache_root);

// cb(err, data).
// data - [{sha:sha1, name:branch_or_tag_name}]
function asyncPhaserBuilds (cb) {

  var builds = cache.getKey('builds');
  if (builds) {
    cb(null, {versions:
      builds
    });
    return;
  }

  var request = require('request-json');
  var client = request.createClient('https://api.github.com');
  // Hopefully there are never more than 100 tags..
  client.get('repos/photonstorm/phaser/git/refs/tags?per_page=100', function (err, response, body) {
    if (response.statusCode == 200) 
    {
      var data = body;
      var tags = [];
      var i = data.length;

      tags.push({
        name: 'local',
        sha: ''
      });

      while (i--) {
        var item = data[i];
        if (item['ref']) {
          // The version name is the tag name without the 'v' which was introduced later
          var versionName = item['ref'].replace(/^refs\/tags\/v?/,'');

          tags.push({
            name: versionName,
            sha: item['object']['sha']
          });
        }
      }

      var res = {
        versions: tags
      };
      cache.setKey('builds', tags);
      cache.save();

      cb(null, res);
    }
    else 
    {
      cb('error:' + JSON.stringify(body));
    }
  });

}

// Returns a list of the available phaser versions that can
// be serviced. The actual JS may still need to be downloaded.
app.get('/phaser/versions', function (req, res, next) {
	
  asyncPhaserBuilds(function (err, data) {
    if (!err) {
      res.send(200, {versions: data.versions});
    } else {
      next(err);
    }
  });

})

function serveLocalPhaserVersion(req, res, next, version) {

  var filePath = path.join(local_root, version != null ? "phaser-" + version + ".js" : "phaser.js");

  var readStream = fs.createReadStream(filePath);

  readStream.on('error', function (err) {
    console.log('Failed to read local Phaser build: %s', filePath);
    next(err);
  });  

  readStream.pipe(res);

}

// Fetch a specific Phaser script version
// The Phaser Version is ultimately fetched from Git (or perhaps a local path)
// but cached locally for future offline access.
//   version: a short version name such as '4.3.1', 'master', or 'local'
app.get('/phaser/phaser-:version.js', function (req, res, next) {
	var request = require('request');

  asyncPhaserBuilds(function (err, data)
  {
    if (err) {
      next(err);
      return;
    }

    var versionName = req.params.version;

    var m = versionName.match(/^local(?:[.](.*))?/);
    if (m) {
      serveLocalPhaserVersion(req, res, next, m[1]);
      return;
    }

    var versions = data.versions;

    var targetVersion = data.versions.filter(function (version) {
      return version.name === versionName;
    })[0];

    if (!targetVersion) {
      console.log("No target version found: " + versionName);
      next("error");
      return;
    }

    // The specific SHA is used in the CDN url to avoid stale cahce pulls, mainly with branch names.
    // The URL could also use the non-CDN rawgit but the SHA information is already available.
    var targetSha = targetVersion.sha;
    var phaserUrl = "https://cdn.rawgit.com/photonstorm/phaser/" + targetSha + "/build/phaser.js";

    res.setHeader("X-Origin-Resource", phaserUrl);

    //fs.readFile(path.combine(cache_root, 'phaser-' + targetSha + ".js"), "r", function (err, )
    var f = path.join(cache_root, "phaser-" + targetSha + ".js");

    readStream = fs.createReadStream(f);
    readStream.on('error', function (err) {
      console.log('error in reading ' + f + " requesting proxy")
      readStream.unpipe();

      var t = path.join(cache_root, "_" + ((Math.random() * 40000) << 0));
      // Nope, so try to create    
      var writeStream = fs.createWriteStream(t);
      
      writeStream.on('error', function (err) {
        console.log("Unable to write to cache: " + e);

        try {
          fs.unlinkSync(t);
        } catch (e) {
          // Don't care
        }

        next(err);
      });
      
      writeStream.on('finish', function (err) {

        console.log("Remote dowload complete - renaming temp file");

        try {
          fs.renameSync(t, f);
        } catch (e) {
          try {
            fs.unlinkSync(t);
          } catch (e) {
            // Don't care
          }
        }

        readStream = fs.createReadStream(f);
        readStream.on('error', function (err) {
          console.log('error in reading (after fetch)');
          next(err);
        });

        readStream.pipe(res);
      });

      request(phaserUrl).pipe(writeStream);

    });

    // Automatically ends request
    readStream.pipe(res);

  });

//	request(phaserUrl, function (error, response, body) {
//		if (response.statusCode == 200) {
//			response.pipe(res);
//		} else {
//			next(error + "hi!" + response.statusCode + ":" + phaserUrl);
//		}
//	});
   
});

  
var server = app.listen(PORT, function () {
  var host = server.address().address;
  var port = server.address().port;
      
  console.log('Example app listening at http://%s:%s', host, port);
  console.log('  EXAMPLE_PATH: %s', example_root);
  console.log('     SITE_PATH: %s', playground_root);
  console.log('     CAHE_PATH: %s', cache_root);
  console.log('  LOCAL_BUILDS: %s', local_root);
});

app.use('/', express.static(playground_root));

app.use('/assets', express.static(path.join(example_root, 'assets')));
app.use('/examples', express.static(example_root));



