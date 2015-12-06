var baseMsHealthModel = require('./baseMsHealth.model'),
  conf = require('../config/conf');

exports.toJson = function (dailySummary) {
  var json = {
    id: dailySummary.id,
    userId: dailySummary.user_id,
    dayId: dailySummary.day_id,
    stepsTaken: dailySummary.steps_taken,
    caloriesBurned: dailySummary.calories_burned,
    distance: dailySummary.distance,
    averageHeartRate: dailySummary.average_heart_rate,
    peakHeartRate: dailySummary.peak_heart_rate,
    lowestHeartRate: dailySummary.lowest_heart_rate
  };

  // Get Steps and Calorie Chart Data
  json.chartCalories = [
    {
      value: json.caloriesBurned,
      color: conf.colors.primaryHex,
      highlight: conf.colors.primaryHighlightHex,
      label: 'Calories Burned'
    },
    {
      value: json.caloriesBurned > 3000 ? 0 : 3000 - json.caloriesBurned,
      color: conf.colors.secondaryHex,
      highlight: conf.colors.secondaryHighlightHex,
      label: 'Remaining to Goal'
    }
  ];

  json.chartSteps = [
    {
      value: json.stepsTaken,
      color: conf.colors.primaryHex,
      highlight: conf.colors.primaryHighlightHex,
      label: 'Steps Taken'
    },
    {
      value: json.stepsTaken > 9000 ? 0 : 9000 - json.stepsTaken,
      color: conf.colors.secondaryHex,
      highlight: conf.colors.secondaryHighlightHex,
      label: 'Remaining to Goal'
    }
  ];

  return json;
};

exports.fromJson = function (msHealthDailySummary) {
  var dailySummary = {
    user_id: conf.msftHealth.gentryId,
    steps_taken: msHealthDailySummary.stepsTaken,
    distance: msHealthDailySummary.distanceSummary.totalDistance
  };

  dailySummary = baseMsHealthModel.getDayId(msHealthDailySummary, dailySummary);
  dailySummary = baseMsHealthModel.getCaloricSummary(msHealthDailySummary, dailySummary);
  dailySummary = baseMsHealthModel.getHeartRateSummary(msHealthDailySummary, dailySummary);


  return dailySummary;
};
