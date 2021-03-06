var model = require('../models/userDailySummary.model'),
  dailySummaryHourModel = require('../models/dailySummaryHour.model'),
  tableName = 'user_daily_summary',
  baseRepo = require('./base.repo')(tableName, model),
  Q = require('q'),
  db = require('../db'),
  Treeize = require('treeize');

var repo = {};
repo.getById = baseRepo.getById;

repo.getByIds = function (ids) {
  var dfd = Q.defer(),
    modeledResults = [];
  if (!ids || ids.length < 1) {
    dfd.resolve(modeledResults);
    return;
  }

  var query = 'SELECT uds.*,' +
    ' dsh.id as `hours:id`,' +
    ' dsh.user_daily_summary_id as `hours:user_daily_summary_id`,' +
    ' dsh.day_id as `hours:day_id`,' +
    ' dsh.start_time as `hours:start_time`,' +
    ' dsh.end_time as `hours:end_time`,' +
    ' dsh.steps_taken as `hours:steps_taken`,' +
    ' dsh.calories_burned as `hours:calories_burned`,' +
    ' dsh.average_heart_rate as `hours:average_heart_rate`,' +
    ' dsh.peak_heart_rate as `hours:peak_heart_rate`,' +
    ' dsh.lowest_heart_rate as `hours:lowest_heart_rate`' +
    ' FROM user_daily_summary uds' +
    ' LEFT JOIN daily_summary_hour dsh ON (dsh.user_daily_summary_id = uds.id)' +
    ' WHERE uds.id IN (?) AND HOUR(dsh.start_time) > 4 AND HOUR(dsh.start_time) < 21' +
    ' ORDER BY uds.day_id DESC, dsh.start_time;';

  query = db.raw(query, [ids]);
  query.then(function(summaries) {
    var dailySummaryTree = new Treeize();
    dailySummaryTree.grow(summaries[0]);
    var dailySummaries = dailySummaryTree.getData();
    dailySummaries.forEach(function (summary) {
      var jsonSummary = model.toJson(summary);

      jsonSummary.hours = [];
      if (summary.hours) {
        summary.hours.forEach(function (hour) {
          var jsonHour = dailySummaryHourModel.toJson(hour);
          jsonSummary.hours.push(jsonHour);
        });
      }

      modeledResults.push(jsonSummary);
    });

    dfd.resolve(modeledResults);
  });

  return dfd.promise;
};

repo.getByDayId = function (dayId) {
  return baseRepo.getById(dayId, 'day_id');
};
repo.createOrUpdate = baseRepo.createOrUpdate;
repo.createIfDoesNotYetExist = function (obj) {
  var dbReady = model.fromJson(obj);
  repo.getByDayId(dbReady.day_id)
    .then(function (found) {
      dbReady.id = found.id;
      repo.createOrUpdate(dbReady, false);
    })
    .catch(function () {
      repo.createOrUpdate(dbReady, false);
    });
};
repo.del = baseRepo.del;

repo.getActivityLevelByMonths = function() {
  var query = "SELECT " +
    "  MONTHNAME(day_id) as month, " +
    "  ROUND(AVG(calories_burned)) as avgCals, " +
    "  ROUND(AVG(steps_taken)) as avgSteps " +
    "FROM user_daily_summary " +
    "WHERE calories_burned > 0 AND steps_taken > 0 " +
    "GROUP BY MONTH(day_id) " +
    "ORDER BY MONTH(day_id);";

  return db.raw(query)
    .then(function (results) {
      return model.getActivityLevelByMonthsData(results[0]);
    });
};

repo.getWeekendsVsWeekdays = function() {
  var query = "SELECT AVG(weekendDays.calories_burned) AS weekends, AVG(weekDays.calories_burned) AS weekdays " +
    "FROM ( " +
    "  SELECT calories_burned " +
    "  FROM user_daily_summary uds " +
    "  WHERE uds.id IN (SELECT id FROM user_daily_summary WHERE DAYOFWEEK(day_id) IN (1,2)) " +
    "    AND uds.calories_burned > 0 " +
    ") weekendDays, ( " +
    "  SELECT calories_burned " +
    "  FROM user_daily_summary uds " +
    "  WHERE uds.id IN (SELECT id FROM user_daily_summary WHERE DAYOFWEEK(day_id) IN (2,3,4,5,6)) " +
    "    AND uds.calories_burned > 0 " +
    ") AS weekDays;";

  return db.raw(query)
    .then(function (results) {
      return results[0];
    });
};

repo.getCalorieAggregates = function() {
  var promises = [];
  promises.push(repo.getWeekendsVsWeekdays());
  Q.all(promises).then(function(results) {

  });
};

module.exports = repo;
