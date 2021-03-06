var model = require('../models/sleepSegment.model'),
  tableName = 'sleep_segment',
  baseRepo = require('./base.repo')(tableName, model);

var repo = {};
repo.getById = baseRepo.getById;
repo.getByIds = baseRepo.getByIds;
repo.createOrUpdate = baseRepo.createOrUpdate;
repo.createOrUpdateWithParent = function (obj, parentId) {
  var dbReady = model.fromJson(obj);
  dbReady.user_sleep_id = parentId;
  repo.createOrUpdate(dbReady, false);
};
repo.del = baseRepo.del;

module.exports = repo;
