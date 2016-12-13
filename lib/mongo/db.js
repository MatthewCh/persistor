module.exports = function (PersistObjectTemplate) {

    var Promise = require('bluebird');

    /* Mongo implementation of save */
    PersistObjectTemplate.savePojoToMongo = function(obj, pojo, updateID, txn, logger) {
        (logger || this.logger).debug({component: 'persistor', module: 'db', activity: 'write'}, 'saving ' + obj.__template__.__name__ + " to " + obj.__template__.__collection__);
        var origVer = obj.__version__;
        obj.__version__ = obj.__version__ ? obj.__version__ + 1 : 1;
        pojo.__version__ = obj.__version__;
        var db = this.getDB(this.getDBAlias(obj.__template__.__collection__)).connection;
        var collection = db.collection(this.dealias(obj.__template__.__collection__));
        return (updateID ?
            collection.update(origVer  ? {__version__: origVer, _id: updateID} :  {_id: updateID}, pojo, {w:1}) :
            collection.save(pojo, {w:1})
        );
        // ).then (function (error, count) {
        //     if (error instanceof Array)
        //         count = error[0]; // Don't know why things are returned this way
        //     if (updateID && count == 0) {
        //         obj.__version__ = origVer;
        //         if (txn && txn.onUpdateConflict) {
        //             txn.onUpdateCoxnflict(pojo)
        //             txn.updateConflict =  new Error("Update Conflict");
        //         } else
        //             throw new Error("Update Conflict");
        //     }
        //     (logger || this.logger).debug({component: 'persistor', module: 'db', activity: 'write'}, 'saved ' + obj.__template__.__name__ + " to " + obj.__template__.__collection__);
        //     return true;
        // }.bind(this));
    }

    /**
     * Removes documents based on a query
     * @param template
     * @param query
     * @returns {Promise}
     */
    PersistObjectTemplate.deleteFromMongoQuery = function(template, query, logger) {
        var db = this.getDB(this.getDBAlias(template.__collection__)).connection;
        var collection = db.collection( this.dealias(template.__collection__));
        return collection.remove(query, {w:1, fsync:true});
    }

    PersistObjectTemplate.getPOJOFromMongoQuery = function(template, query, options, logger) {
        (logger || this.logger).debug({component: 'persistor', module: 'db', activity: 'read'}, "db." + template.__collection__ + ".find({" + JSON.stringify(query) + "})");
        var db = this.getDB(this.getDBAlias(template.__collection__)).connection;
        var collection = db.collection( this.dealias(template.__collection__));
        options = options || {};
        if (!options.sort)
            options.sort = {_id:1};
        return collection.find(query, null, options);
    }

    PersistObjectTemplate.countFromMongoQuery = function(template, query) {
        var db = this.getDB(this.getDBAlias(template.__collection__)).connection;
        var collection = db.collection( this.dealias(template.__collection__));
        return collection.count(query);
    }

    PersistObjectTemplate.distinctFromMongoQuery = function(template, field, query) {
        var db = this.getDB(this.getDBAlias(template.__collection__)).connection;
        var collection = db.collection( this.dealias(template.__collection__));
        return collection._collection.distinct(field, query);
    }

    PersistObjectTemplate.getPOJOFromMongoId = function (template, id, cascade, isTransient, idMap) {
        var self = this;
        idMap = idMap || {};
        return this.getPOJOFromQuery(template, {_id: new this.ObjectID(id)}, idMap).then(function(pojos) {
            if (pojos.length > 0)
                return pojos[0];
            else
                return null;
        });
    }

}