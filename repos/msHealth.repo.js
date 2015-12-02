var conf = require('../config/conf'),
  Q = require('q'),
  mySqlDbPool = require('../mySqlDbPool'),
  userRepo = require('./user.repo')(mySqlDbPool),
  userWorkoutRepo = require('./userWorkout.repo'),
  userRunRepo = require('./userRun.repo'),
  userSleepRepo = require('./userSleep.repo'),
  userDailySummaryRepo = require('./userDailySummary.repo'),
  httpsService = require('../services/https.service'),
  multiline = require('multiline'),
  db = require('../db'),
  _ = require('lodash'),
  moment = require('moment'),
  apiToken, refreshToken;

function getMSHealthUserTokens() {
  var dfd = Q.defer();
  if (apiToken && refreshToken) {
    dfd.resolve();
  } else {
    userRepo.getById(conf.msftHealth.gentryId, true)
      .then(function (user) {
        apiToken = user.msHealthToken;
        refreshToken = user.msHealthRefreshToken;
        dfd.resolve();
      });
  }

  return dfd.promise;
}

function getAuthHeaders() {
  return {
    'Authorization': 'bearer ' + apiToken
  };
}

function getRefreshToken() {
  var dfd = Q.defer();
  var url = conf.msftHealth.refreshUrl
    .replace("{client_id}", conf.msftHealth.clientId)
    .replace("{redirect_uri}", conf.msftHealth.redirectUri)
    .replace("{client_secret}", conf.msftHealth.clientSecret)
    .replace("{refresh_token}", refreshToken)
    .replace("{grant_type}", conf.msftHealth.grantType);

  httpsService.get(url)
    .then(function (data) {
      apiToken = data.access_token;
      refreshToken = data.refresh_token;
      userRepo.createOrUpdate({
          id: conf.msftHealth.gentryId,
          mshealth_token: apiToken,
          mshealth_refresh_token: refreshToken
        }, false)
        .then(function () {
          dfd.resolve();
        })
        .catch(function (err) {
          dfd.reject(err);
        });
    })
    .catch(function (err) {
      dfd.reject(err);
    });

  return dfd.promise;
}

function ensureAuth() {
  var dfd = Q.defer();
  getMSHealthUserTokens()
    .then(function () {
      var url = conf.msftHealth.apiURL.replace("{path}", 'Profile').replace("{parameters}", '');
      httpsService.get(url, getAuthHeaders())
        .then(function (resp) {
          dfd.resolve(resp);
        })
        .catch(function () {
          getRefreshToken()
            .then(function () {
              dfd.resolve();
            })
            .catch(function (err) {
              dfd.reject(err);
            });
        });
    })
    .catch(function (err) {
      dfd.reject(err);
    });

  return dfd.promise;
}

function getParameters(parameters) {
  var queryParameters, p;
  queryParameters = "";

  if (parameters) {
    for (p in parameters) {
      if (parameters[p]) {
        queryParameters = queryParameters.concat(encodeURI(p) + "=" + encodeURI(parameters[p]) + "&");
      }
    }
  }

  return queryParameters.substring(0, queryParameters.length - 1);
}

function queryAPI(options) {
  var dfd = Q.defer();
  // Ensure we have user info
  ensureAuth()
    .then(function () {
      var queryParameters = options.parameters ? getParameters(options.parameters) : "";
      var url = conf.msftHealth.apiURL.replace("{path}", options.path).replace("{parameters}", queryParameters);

      httpsService.get(url, getAuthHeaders())
        .then(function (resp) {
          dfd.resolve(resp);
        })
        .catch(function (resp) {
          dfd.reject(resp);
        });
    })
    .catch(function (err) {
      dfd.reject(err);
    });

  return dfd.promise;
}

var msHealthRepo = {};

msHealthRepo.ensureStartAndEndTime = function (startTime, endTime) {
  startTime = startTime ? moment.utc(startTime) : moment.utc();
  startTime.hour(0);
  startTime.minute(0);
  startTime.second(0);

  endTime = endTime ? moment.utc(endTime) : moment.utc(startTime);
  endTime.hour(23);
  endTime.minute(59);
  endTime.second(59);

  return {
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString()
  };
};

msHealthRepo.getAllActivities = function (startTime, endTime) {
  var parameters = msHealthRepo.ensureStartAndEndTime(startTime, endTime);

  var options = {
    path: 'Activities',
    parameters: parameters
  };

  queryAPI(options)
    .then(function (resp) {
      if (resp.freePlayActivities) {
        resp.freePlayActivities.forEach(function (workout) {
          userWorkoutRepo.createIfDoesNotYetExist(workout);
        });
      }
      if (resp.runActivities) {
        resp.runActivities.forEach(function (run) {
          userRunRepo.createIfDoesNotYetExist(run);
        });
      }
      if (resp.sleepActivities) {
        resp.sleepActivities.forEach(function (sleep) {
          userSleepRepo.createIfDoesNotYetExist(sleep);
        });
      }
    });
};

msHealthRepo.getDailySummary = function (startTime, endTime) {
  var parameters = msHealthRepo.ensureStartAndEndTime(startTime, endTime);
  var options = {
    path: 'Summaries/Daily',
    parameters: parameters
  };

  queryAPI(options)
    .then(function (resp) {
      if (resp.summaries) {
        resp.summaries.forEach(function (dailySummary) {
          userDailySummaryRepo.createIfDoesNotYetExist(dailySummary);
        });
      }
    })
    .catch(function (resp) {
      console.log('Failed to get Daily Summaries', resp);
    });
};

msHealthRepo.sync = function (startTime, endTime) {
  msHealthRepo.getAllActivities(startTime, endTime);
  msHealthRepo.getDailySummary(startTime, endTime);
  var now = new Date();
  now = now.toMysqlFormat();
  userRepo.createOrUpdate({
    id: conf.msftHealth.gentryId,
    mshealth_last_update: now
  });
};

msHealthRepo.getAll = function (startTime, endTime) {
  var dfd = Q.defer();
  var options = msHealthRepo.ensureStartAndEndTime(startTime, endTime);
  var sleepStartTime = moment.utc(options.startTime).subtract(1, 'days').toISOString();
  var query = multiline.stripIndent(function () {/*
   SELECT *
   FROM (
   (SELECT TRUE AS isWorkout, FALSE AS isRun, FALSE as isSleep, FALSE as isSummary, id, start_time
   FROM user_workout
   WHERE day_id >= ? AND day_id <= ?)
   UNION ALL
   (SELECT FALSE isWorkout, TRUE AS isRun, FALSE as isSleep, FALSE as isSummary, id, start_time
   FROM user_run
   WHERE day_id >= ? AND day_id <= ?)
   UNION ALL
   (SELECT FALSE isWorkout, FALSE AS isRun, TRUE as isSleep, FALSE as isSummary, id, start_time
   FROM user_sleep
   WHERE day_id >= ? AND day_id <= ?)
   UNION ALL
   (SELECT FALSE isWorkout, FALSE AS isRun, FALSE as isSleep, TRUE as isSummary, id, day_id as start_time
   FROM user_daily_summary
   WHERE day_id >= ? AND day_id <= ?)
   ) results
   ORDER BY results.start_time
   */
  });
  query = db.formatQuery(query);
  query = db.raw(query, [options.startTime, options.endTime, options.startTime, options.endTime, sleepStartTime,
    options.startTime, options.startTime, options.endTime]);
  query.then(function (results) {
      var workoutIds = [],
        runIds = [],
        sleepIds = [],
        summaryIds = [];
      for (var i = 0; i < results[0].length; i++) {
        var result = results[0][i];
        if (result.isWorkout) {
          workoutIds.push(result.id);
        } else if (result.isRun) {
          runIds.push(result.id);
        } else if (result.isSleep) {
          sleepIds.push(result.id);
        } else if (result.isSummary) {
          summaryIds.push(result.id);
        }
      }

      var promises = [];
      promises.push(userWorkoutRepo.getByIds(workoutIds, false, 'start_time'));
      promises.push(userRunRepo.getByIds(runIds, false, 'start_time'));
      promises.push(userSleepRepo.getByIds(sleepIds, false, 'start_time'));
      promises.push(userDailySummaryRepo.getByIds(summaryIds, false, 'day_id'));
      promises.push(userRepo.getById(conf.msftHealth.gentryId, true));

      Q.all(promises)
        .then(function (promiseResults) {
          var response = [];
          for (var j = 0; j < promiseResults[3].length; j++) {
            var summary = promiseResults[3][j];
            summary.lastSync = promiseResults[4].msHealthLastSync;
            var summaryDayId = summary.dayId.getTime();
            var sleepDayId = summaryDayId - (24 * 60 * 60 * 1000);
            var matches = [];
            // Get all Workouts, Runs and Sleeps
            promiseResults[0].forEach(function (workout) {
              if (workout.dayId.getTime() == summaryDayId) {
                workout.isWorkout = true;
                matches.push(workout);
              }
            });
            promiseResults[1].forEach(function (run) {
              if (run.dayId.getTime() == summaryDayId) {
                run.isRun = true;
                matches.push(run);
              }
            });
            promiseResults[2].forEach(function (sleep) {
              if (sleep.dayId.getTime() == sleepDayId) {
                sleep.isSleep = true;
                matches.push(sleep);
              }
            });

            // Order results by startTime
            summary.items = _.sortBy(matches, 'startTime');
            response.push(summary);
          }

          dfd.resolve(response);
        });
    })
    .catch(function (err) {
      dfd.reject(err);
    });

  return dfd.promise;
};

module.exports = msHealthRepo;
