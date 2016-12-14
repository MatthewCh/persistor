/**
 *  All public interfaces are contained here.  They either fan out to query.js, update.js or db.js in the
 *  individual database directories.  Three kinds of interfaces are available
 *
 *  - Object Intefaces are methods added to objects instantiated from PersistObjectTemplate contexts
 *
 *  - Template interfaces are methods added to templates instantiated from PersistObjectTemplate
 *
 *  - ObjectTemplate intefaces are session level interfaces
 *
 */

module.exports = function (PersistObjectTemplate, baseClassForPersist) {

    var Promise = require('bluebird');
    var _ = require('underscore');

    /**
     * PUBLIC INTERFACE FOR OBJECTS
     */

    PersistObjectTemplate._injectIntoObject = function (object) {
        baseClassForPersist._injectIntoObject(object);
        var self = this;

        object.persistSave = function (txn, logger) {
            (logger || PersistObjectTemplate.logger).debug({component: 'persistor', module: 'api', activity: 'persistSave',
                data: {template: object.__template__.__name__, id: object.__id__}});
            var dbType = PersistObjectTemplate.getDB(PersistObjectTemplate.getDBAlias(object.__template__.__collection__)).type;
            return dbType == PersistObjectTemplate.DB_Mongo ?
                PersistObjectTemplate.persistSaveMongo(object, undefined, undefined, undefined, txn, logger)
                    .then (function (obj) {
                        if (txn) {
                            PersistObjectTemplate.saved(obj, txn);
                        }
                        return Promise.resolve(obj._id.toString())
                    })
                : PersistObjectTemplate.persistSaveKnex(object, txn, logger)
                .then (function (obj) {
                    if (txn) {
                        PersistObjectTemplate.saved(obj, txn);
                    }
                    return Promise.resolve(obj._id.toString());
                });
        };

        object.persistTouch = function (txn, logger) {
            (logger || PersistObjectTemplate.logger).debug({component: 'persistor', module: 'api', activity: 'persistTouch',
                data: {template: object.__template__.__name__, id: object.__id__}});
            var dbType = PersistObjectTemplate.getDB(PersistObjectTemplate.getDBAlias(object.__template__.__collection__)).type;
            return dbType == PersistObjectTemplate.DB_Mongo ?
                PersistObjectTemplate.persistSaveMongo(object, undefined, undefined, undefined, txn, logger)
                : PersistObjectTemplate.persistTouchKnex(object, txn, logger);
        };

        object.persistDelete = function (txn, logger) {
            (logger || PersistObjectTemplate.logger).debug({component: 'persistor', module: 'api', activity: 'persistDelete',
                data: {template: object.__template__.__name__, id: object.__id__}});
            if (txn) {
                delete txn.dirtyObjects[this.__id__];
            }
            return this.__template__.deleteFromPersistWithId(this._id, txn, logger)
        };

        object.setDirty = function (txn, onlyIfChanged, cascade, logger) {
            PersistObjectTemplate.setDirty(this, txn, onlyIfChanged, !cascade, logger);
        };

        object.cascadeSave = function (txn, logger) {
            PersistObjectTemplate.setDirty(this, txn || PersistObjectTemplate.currentTransaction, true, false, logger);
        };

        object.isStale = function () {
            var dbType = PersistObjectTemplate.getDB(PersistObjectTemplate.getDBAlias(this.__template__.__collection__)).type;
            return this.__template__.countFromPersistWithQuery(
                {_id: (dbType == PersistObjectTemplate.DB_Mongo) ? PersistObjectTemplate.ObjectID(this._id.toString()) : this._id,
                    __version__: this.__version__}).then(function(count) {
                        return !count
                    });
        };

        object.fetchProperty = function (prop, cascade, queryOptions, isTransient, idMap, logger) {
            (logger || PersistObjectTemplate.logger).debug({component: 'persistor', module: 'api', activity: 'fetchProperty',
                data: {template: object.__template__.__name__, id: object.__id__}});
            idMap = idMap || {};
            var properties = {};
            var objectProperties = this.__template__.getProperties();
            properties[prop] = objectProperties[prop];
            if (queryOptions) {
                properties[prop].queryOptions = queryOptions;
            }
            var cascadeTop = {};
            cascadeTop[prop] = cascade || true;

            var dbType = PersistObjectTemplate.getDB(PersistObjectTemplate.getDBAlias(object.__template__.__collection__)).type;
            return dbType == PersistObjectTemplate.DB_Mongo ?
                self.getTemplateFromMongoPOJO(this, this.__template__, null, null, idMap, cascadeTop, this, properties, isTransient, logger) :
                self.getTemplateFromKnexPOJO(this, this.__template__, null, idMap, cascadeTop, isTransient, null, this, properties, undefined, undefined, undefined, logger);

        };

        object.fetch = function (cascade, isTransient, idMap, logger) {
            (logger || PersistObjectTemplate.logger).debug({component: 'persistor', module: 'api', activity: 'fetch',
                data: {template: object.__template__.__name__, id: object.__id__}});
            idMap = idMap || {};

            var properties = {}
            var objectProperties = this.__template__.getProperties();
            for (var prop in cascade) {
                properties[prop] = objectProperties[prop];
            }
            var dbType = PersistObjectTemplate.getDB(PersistObjectTemplate.getDBAlias(object.__template__.__collection__)).type;
            var previousDirtyTracking = PersistObjectTemplate.__changeTracking__;
            PersistObjectTemplate.__changeTracking__ = false;
            return (dbType == PersistObjectTemplate.DB_Mongo ?
                self.getTemplateFromMongoPOJO(this, this.__template__, null, null, idMap, cascade, this, properties, isTransient, logger) :
                self.getTemplateFromKnexPOJO(this, this.__template__, null, idMap, cascade, isTransient, null, this, properties, undefined, undefined, undefined, logger))
                .then(function (res) {
                    return res;
                })
                .finally(function () {
                    PersistObjectTemplate.__changeTracking__ = previousDirtyTracking;
                });


        };
        object.refresh = function (logger) {
            (logger || PersistObjectTemplate.logger).debug({component: 'persistor', module: 'api', activity: 'refresh',
                data: {template: object.__template__.__name__, id: object.__id__}});
            return this.__template__.getFromPersistWithId(object._id, null, null, null, true, logger)
        };
    };
    PersistObjectTemplate.getPersistorProps = function () {
        var persistorProps = {};
        _.each(PersistObjectTemplate.__dictionary__, processTemplate);
        return persistorProps;

        function processTemplate(template) {

            var props = template.getProperties();
            _.each(props, processDefineProperty);

            function processDefineProperty(_defineProperty, prop) {
                if (prop.match(/Persistor$/) && prop.substr(0, 2) != '__') {
                    persistorProps[template.__name__] = persistorProps[template.__name__] || {}
                    persistorProps[template.__name__][prop.replace(/Persistor$/, '')] = 1;
                }
            }
        }
    }

    /**
     * PUBLIC INTERFACE FOR TEMPLATES
     *
     * @param {supertype} template - load all parent/child/subdocument/subsetof defitions
     */
    PersistObjectTemplate._injectIntoTemplate = function (template) {
        if (!this.schemaVerified) {
            this._verifySchema();
        }
        this.schemaVerified = true;

        // Process subclasses that didn't have schema entries
        var parent = template.__parent__;
        while (!template.__schema__ && parent) {
            if (parent.__schema__) {
                template.__schema__ = parent.__schema__;
                template.__collection__ = parent.__collection__;
                template.__table__ = template.__schema__.table ? template.__schema__.table : parent.__table__;
                template.__topTemplate = parent.__topTemplate__;
                parent = null;
            } else {
                parent = parent.__parent__;
            }
        }

        // Process subsets
        if (template.__schema__ && template.__schema__.subsetOf) {
            var mainTemplate = this.__dictionary__[template.__schema__.subsetOf];
            if (!mainTemplate) {
                throw new Error('Reference to subsetOf ' + template.__schema__.subsetOf + ' not found for ' + template.__name__);
            }
            template.__subsetOf__ = template.__schema__.subsetOf
            if (!mainTemplate.__schema__) {
                parent = mainTemplate.__parent__;
                while (!mainTemplate.__schema__ && parent) {
                    if (parent.__schema__) {
                        mainTemplate.__schema__ = parent.__schema__;
                        mainTemplate.__collection__ = parent.__collection__;
                        mainTemplate.__table__ = mainTemplate.__schema__.table ? mainTemplate.__schema__.table : parent.__table__;
                        mainTemplate.__topTemplate = parent.__topTemplate__;
                        parent = null;
                    } else {
                        parent = parent.__parent__;
                    }
                }
                if (!mainTemplate.__schema__) {
                    throw new Error('Missing schema entry for ' + template.__schema__.subsetOf);
                }
            }
            mergeRelationships(template.__schema__, mainTemplate.__schema__);
            template.__collection__ = mainTemplate.__collection__;
            template.__table__ = mainTemplate.__table__;
        }
        baseClassForPersist._injectIntoTemplate(template);

        function mergeRelationships(orig, overlay) {
            _.each(overlay.children, function (value, key) {
                orig.children = orig.children || {};
                if (!orig.children[key]) {
                    orig.children[key] = value;
                }
            });
            _.each(overlay.parents, function (value, key) {
                orig.parents = orig.parents || {};
                if (!orig.parents[key]) {
                    orig.parents[key] = value;
                }
            });
        }

        /**
         * Return a single instance of an object of this class given an id
         *
         * @param {string} id mongo style id
         * @param {bool} cascade, loads children if requested
         * @param {bool} isTransient - marking the laoded object as transient.
         * @param {object} idMap id mapper for cached objects
         * @param {bool} isRefresh force load
         * @param {object} logger objecttemplate logger
         * @returns {object}
         */
        template.getFromPersistWithId = function(id, cascade, isTransient, idMap, isRefresh, logger) {
            (logger || PersistObjectTemplate.logger).debug({component: 'persistor', module: 'api', activity: 'getFromPersistWithId',
                data: {template: template.__name__, id: id}});
            var dbType = PersistObjectTemplate.getDB(PersistObjectTemplate.getDBAlias(template.__collection__)).type;
            return (dbType == PersistObjectTemplate.DB_Mongo ?
                PersistObjectTemplate.getFromPersistWithMongoId(template, id, cascade, isTransient, idMap, logger) :
                PersistObjectTemplate.getFromPersistWithKnexId(template, id, cascade, isTransient, idMap, isRefresh, logger))
                .then(function(res) {
                    return res;
                }.bind(this))
        };

        /**
         * Return an array of objects of this class given a json query
         *
         * @param {json} query mongo style queries
         * @param {bool} cascade, loads children if requested
         * @param {numeric} start - starting position of the result set.
         * @param {numeric} limit - limit the result set
         * @param {bool} isTransient {@TODO}
         * @param {object} idMap id mapper for cached objects
         * @param {bool} options {@TODO}
         * @param {object} logger objecttemplate logger
         * @returns {object}
         */
        template.getFromPersistWithQuery = function(query, cascade, start, limit, isTransient, idMap, options, logger) {
            (logger || PersistObjectTemplate.logger).debug({component: 'persistor', module: 'api', activity: 'getFromPersistWithQuery',
                data: {template: template.__name__}});
            var dbType = PersistObjectTemplate.getDB(PersistObjectTemplate.getDBAlias(template.__collection__)).type;
            return (dbType == PersistObjectTemplate.DB_Mongo ?
                PersistObjectTemplate.getFromPersistWithMongoQuery(template, query, cascade, start, limit, isTransient, idMap, options, logger) :
                PersistObjectTemplate.getFromPersistWithKnexQuery(null, template, query, cascade, start, limit, isTransient, idMap, options, undefined, undefined, logger))
                .then(function(res) {
                    return res;
                }.bind(this))
        };

        /**
         * Delete objects given a json query
         *
         * @param {json} query mongo style queries
         * @param {object} txn persistObjectTemplate transaciton object
         * @param {object} logger objecttemplate logger
         * @returns {object}
         */
        template.deleteFromPersistWithQuery = function(query, txn, logger) {
            var dbType = PersistObjectTemplate.getDB(PersistObjectTemplate.getDBAlias(template.__collection__)).type;
            return dbType == PersistObjectTemplate.DB_Mongo ?
                PersistObjectTemplate.deleteFromPersistWithMongoQuery(template, query, logger) :
                PersistObjectTemplate.deleteFromPersistWithKnexQuery(template, query, txn, logger);
        };

        /**
         * Delete objects given a json query
         *
         * @param {string} id mongo style id
         * @param {object} txn persistObjectTemplate transaciton object
         * @param {object} logger objecttemplate logger
         * @returns {object}
         */
        template.deleteFromPersistWithId = function(id, txn, logger) {
            (logger || PersistObjectTemplate.logger).debug({component: 'persistor', module: 'api', activity: 'deleteFromPersistWithId',
                data: {template: template.__name__, id: id}});
            var dbType = PersistObjectTemplate.getDB(PersistObjectTemplate.getDBAlias(template.__collection__)).type;
            return (dbType == PersistObjectTemplate.DB_Mongo ?
                PersistObjectTemplate.deleteFromPersistWithMongoId(template, id, logger) :
                PersistObjectTemplate.deleteFromPersistWithKnexId(template, id, txn, logger))
                .then(function(res) {
                    return res;
                }.bind(this))
        };

        /**
         * Return count of objects of this class given a json query
         *
         * @param {json} query mongo style queries
         * @param {object} logger objecttemplate logger
         * @returns {Number}
         */
        template.countFromPersistWithQuery = function(query, logger) {
            (logger || PersistObjectTemplate.logger).debug({component: 'persistor', module: 'api', activity: 'countFromPersistWithQuery',
                data: {template: template.__name__}});
            var dbType = PersistObjectTemplate.getDB(PersistObjectTemplate.getDBAlias(template.__collection__)).type;
            return (dbType == PersistObjectTemplate.DB_Mongo ?
                PersistObjectTemplate.countFromMongoQuery(template, query, logger) :
                PersistObjectTemplate.countFromKnexQuery(template, query, logger))
                .then(function(res) {
                    return res;
                }.bind(this))
        };
        /**
         * Determine whether we are using knex on this table
         * @returns {boolean}
         */
        template.isKnex = function () {
            var dbType = PersistObjectTemplate.getDB(PersistObjectTemplate.getDBAlias(template.__collection__)).type;
            return dbType != PersistObjectTemplate.DB_Mongo;
        };
        /**
         * Get a knex object that can be used to create native queries (e.g. template.getKnex().select().from())
         * @returns {*}
         */
        template.getKnex = function () {
            var tableName = PersistObjectTemplate.dealias(template.__table__);
            return PersistObjectTemplate.getDB(PersistObjectTemplate.getDBAlias(template.__table__)).connection(tableName);
        };
        /**
         * Return knex table name for template for use in native queries
         * @param {string} alias - table alias alias named used when setting the DB object
         * @returns {string}
         */
        template.getTableName = function (alias) {
            return PersistObjectTemplate.dealias(template.__table__) + (alias ? ' as ' + alias : '');
        };
        /**
         * Return the foreign key for a given parent property for use in native queries
         * @param {string} prop field name
         * @param {string} alias - table alias name used for query generation
         * @returns {string}
         */
        template.getParentKey = function (prop, alias) {
            return (alias ? alias + '.'  : '') + template.__schema__.parents[prop].id;
        };
        /**
         * Return the foreign key for a given child property for use in native queries
         * @param {string} prop field name
         * @param {string} alias - table alias name used for query generation
         * @returns {string}
         */
        template.getChildKey = function (prop, alias) {
            return (alias ? alias + '.'  : '') + template.__schema__.children[prop].id;
        };
        /**
         * Return '_id'
         * @param {string} alias - table alias name used for query generation
         * @returns {string}
         */
        template.getPrimaryKey = function (alias) {
            return (alias ? alias + '.'  : '') + '_id';
        };
        /**
         * return an array of join parameters (e.g. .rightOuterJoin.apply(template.getKnex(), Transaction.knexChildJoin(...)))
         * @param {object} targetTemplate objecttemplate
         * @param {string} primaryAlias - table alias name used for query generation
         * @param {string} targetAlias - table alias name used for query generation
         * @param {string} joinKey - field name
         * @returns {*[]}
         */
        template.knexParentJoin = function (targetTemplate, primaryAlias, targetAlias, joinKey) {
            return [template.getTableName() + ' as ' + primaryAlias, targetTemplate.getParentKey(joinKey, targetAlias), template.getPrimaryKey(primaryAlias)];
        };
        /**
         * return an array of join parameters (e.g. .rightOuterJoin.apply(template.getKnex(), Transaction.knexChildJoin(...)))
         * @param {object} targetTemplate target table to join with
         * @param {object} primaryAlias table alias name for the source/current object
         * @param {object} targetAlias table alias name for the target table.
         * @param {string} joinKey source table field name
         * @returns {*[]}
         */
        template.knexChildJoin = function (targetTemplate, primaryAlias, targetAlias, joinKey) {
            return [template.getTableName() + ' as ' + primaryAlias, targetTemplate.getChildKey(joinKey, primaryAlias), targetTemplate.getPrimaryKey(targetAlias)];
        };
        // Add persistors to foreign key references

        var props = template.defineProperties;
        for (var prop in props) {
            var defineProperty = props[prop];
            var type = defineProperty.type;
            var of = defineProperty.of;
            var refType = of || type;

            if (refType && refType.isObjectTemplate && PersistObjectTemplate._persistProperty(defineProperty)) {
                var isCrossDocRef = this.isCrossDocRef(template, prop, defineProperty)
                if (isCrossDocRef || defineProperty.autoFetch) {
                    (function () {
                        var closureProp = prop;
                        var closureFetch = defineProperty.fetch ? defineProperty.fetch : {};
                        var closureQueryOptions = defineProperty.queryOptions ? defineProperty.queryOptions : {};
                        var toClient = !(defineProperty.isLocal || (defineProperty.toClient === false))
                        if (!props[closureProp + 'Persistor']) {
                            template.createProperty(closureProp + 'Persistor', {type: Object, toClient: toClient,
                                toServer: false, persist: false,
                                value: {isFetched: defineProperty.autoFetch ? false : true, isFetching: false}});
                        }
                        if (!template.prototype[closureProp + 'Fetch'])
                            template.createProperty(closureProp + 'Fetch', {on: 'server', body: function (start, limit) {
                                if (typeof(start) != 'undefined') {
                                    closureQueryOptions['skip'] = start;
                                }
                                if (typeof(limit) != 'undefined') {
                                    closureQueryOptions['limit'] = limit;
                                }
                                return this.fetchProperty(closureProp, closureFetch, closureQueryOptions);
                            }});
                    })();
                }
            }
        }
    }
    /**
     * PUBLIC INTERFACE FOR OBJECTTEMPLATE
     */

    /**
     * Begin a transaction that will ultimately be ended with end. It is passed into setDirty so
     * dirty objects can be accumulated.  Does not actually start a knex transaction until end
     * @param {bool} notDefault used for marking the transaction created as the default transaction
     * @returns {object} returns transaction object
     */
    PersistObjectTemplate.begin = function (notDefault) {
        var txn = {id: new Date().getTime(), dirtyObjects: {}, savedObjects: {}, touchObjects: {}};
        if (!notDefault) {
            this.currentTransaction = txn;
        }
        return txn;
    };


    PersistObjectTemplate.end = function(persistorTransaction, logger) {
        (logger || this.logger).debug({component: 'persistor', module: 'api', activity: 'end'}, 'start of transaction ');
        persistorTransaction = persistorTransaction || this.currentTransaction;
        var knex = _.findWhere(this._db, {type: PersistObjectTemplate.DB_Knex}).connection;
        var dirtyObjects = persistorTransaction ? persistorTransaction.dirtyObjects : this.dirtyObjects;
        var touchObjects = persistorTransaction ? persistorTransaction.touchObjects : {};
        var savedObjects = persistorTransaction ? persistorTransaction.savedObjects : {};
        var innerError;

        // Start the knext transaction
        return knex.transaction(function(knexTransaction) {

            persistorTransaction.knex = knexTransaction;

            Promise.resolve(true)
                .then(processPreSave.bind(this))
                .then(processSaves.bind(this))
                .then(processTouches.bind(this))
                .then(processPostSave.bind(this))
                .then(processCommit.bind(this))
                .catch(rollback.bind(this));

            function processPreSave() {
                return persistorTransaction.preSave
                    ? persistorTransaction.preSave.call(persistorTransaction, persistorTransaction, logger)
                    : true
            }

            // Walk through the dirty objects
            function processSaves() {
                return Promise.map(_.toArray(dirtyObjects), function (obj) {
                    delete dirtyObjects[obj.__id__];  // Once scheduled for update remove it.
                    return (obj.__template__ && obj.__template__.__schema__
                        ?  obj.persistSave(persistorTransaction, logger)
                        : true)
                }.bind(this), {concurrency: PersistObjectTemplate.concurrency}).then (function () {
                    if (_.toArray(dirtyObjects). length > 0) {
                        return processSaves.call(this);
                    }
                });

            }

            function processPostSave() {
                return persistorTransaction.postSave ? persistorTransaction.postSave(persistorTransaction, logger)
                    : true;
            }

            // And we are done with everything
            function processCommit() {

                this.dirtyObjects = {};
                this.savedObjects = {};
                if (persistorTransaction.updateConflict) {
                    throw 'Update Conflict';
                }
                return knexTransaction.commit();
            }

            // Walk through the touched objects
            function processTouches() {
                return Promise.map(_.toArray(touchObjects), function (obj) {
                    return (obj.__template__ && obj.__template__.__schema__ && !savedObjects[obj.__id__]
                        ?  obj.persistTouch(persistorTransaction, logger)
                        : true)
                }.bind(this))
            }

            function rollback (err) {
                return knexTransaction.rollback().then (function () {
                    var deadlock = err.toString().match(/deadlock detected$/i)
                    persistorTransaction.innerError = err;
                    innerError = deadlock ? new Error('Update Conflict') : err;
                    (logger || this.logger).debug({component: 'persistor', module: 'api', activity: 'end'}, 'transaction rolled back ' +
                        innerError.message + (deadlock ? ' from deadlock' : ''));
                }.bind(this));
            }
        }.bind(this)).then(function () {
            (logger || this.logger).debug({component: 'persistor', module: 'api'}, 'end - transaction completed');
            return true;
        }.bind(this)).catch(function (e) {
            var err = e || innerError;
            if (err && err.message && err.message != 'Update Conflict') {
                (logger || this.logger).error({component: 'persistor', module: 'api', activity: 'end', error: err.message + err.stack}, 'transaction ended with error');
            } //@TODO: Why throw error in all cases but log only in some cases
            throw (e || innerError);
        }.bind(this))

    };
    /**
     * Set the object dirty along with all descendant objects in the logical "document"
     *
     * @param {supertype} obj objecttempate
     * @param {object} txn persistobjecttemplate transaction object
     * @param {bool} onlyIfChanged mark dirty only if changed
     * @param {bool} noCascade, avoids loading children
     * @param {object} logger objecttemplate logger
     */
    PersistObjectTemplate.setDirty = function (obj, txn, onlyIfChanged, noCascade, logger) {
        var topObject;
        // Get array references too
        if (onlyIfChanged && this.MarkChangedArrayReferences) {
            this.MarkChangedArrayReferences();
        }

        txn = txn || this.currentTransaction;

        if (!obj || !obj.__template__.__schema__) {
            return;
        }

        // Use the current transaction if none passed
        txn = txn || PersistObjectTemplate.currentTransaction || null;

        if (!onlyIfChanged || obj.__changed__) {
            (txn ? txn.dirtyObjects : this.dirtyObjects)[obj.__id__] = obj;
        }

        if (txn && obj.__template__.__schema__.cascadeSave && !noCascade) {
            // Potentially cascade to set other related objects as dirty
            topObject = PersistObjectTemplate.getTopObject(obj);
            if (!topObject) {
                (logger || this.logger).error({component: 'persistor', module: 'api', activity: 'setDirty'}, 'Warning: setDirty called for ' + obj.__id__ + ' which is an orphan');
            }
            if (topObject && topObject.__template__.__schema__.cascadeSave) {
                PersistObjectTemplate.enumerateDocumentObjects(PersistObjectTemplate.getTopObject(obj), function (obj) {
                    if (!onlyIfChanged || obj.__changed__) {
                        (txn ? txn.dirtyObjects : this.dirtyObjects)[obj.__id__] = obj;
                        // Touch the top object if required so that if it will be modified and can be refereshed if needed
                        if (txn && txn.touchTop && obj.__template__.__schema__) {
                            var topObject = PersistObjectTemplate.getTopObject(obj);
                            if (topObject) {
                                txn.touchObjects[topObject.__id__] = topObject;
                            }
                        }

                    }
                }.bind(this));
            }
        }
        if (txn && txn.touchTop && obj.__template__.__schema__) {
            topObject = PersistObjectTemplate.getTopObject(obj);
            if (topObject) {
                txn.touchObjects[topObject.__id__] = topObject;
            }
        }
    };
    PersistObjectTemplate.saveAll = function (txn, logger) {
        var promises = [];
        var somethingSaved = false;
        var dirtyObjects = txn ? txn.dirtyObjects : this.dirtyObjects;
        for (var id in dirtyObjects) {
            (function () {
                var obj = dirtyObjects[id];
                delete dirtyObjects[obj.__id__];
                promises.push(obj.persistSave(txn, logger).then(function () {
                    PersistObjectTemplate.saved(obj, txn);
                    somethingSaved = true;
                }));
            })();
        }

        return Promise.all(promises)
            .then(function () {
                if (!somethingSaved && txn && txn.postSave) {
                    txn.postSave(txn, logger);
                    this.dirtyObjects = {};
                    this.savedObjects = {};
                }
                if (somethingSaved) {
                    return this.saveAll(txn)
                } else {
                    return true;
                }
            }.bind(this));
    }

    /**
     * Set a data base to be used
     * @param {knex|mongoclient} db - the native client objects used
     * @param {knex|mongo} type - the type which is defined in index.js
     * @param {pg|mongo|__default} alias - An alias that can be used in the schema to specify the database at a table level
     */
    PersistObjectTemplate.setDB = function (db, type, alias) {
        type = type || PersistObjectTemplate.DB_Mongo;
        alias = alias || '__default__';
        this._db = this._db || {};
        this._db[alias] = {connection: db, type: type}
    };

    /**
     * retrieve a PLain Old Javascript Object given a query
     * @param {SuperType} template - template to load
     * @param {json|function} query - can pass either mongo style queries or callbacks to add knex calls..
     * @param {json} options - sort, limit, and offset options
     * @param {ObjectTemplate.logger} logger - objecttemplate logger
     * @returns {*}
     */
    PersistObjectTemplate.getPOJOFromQuery = function (template, query, options, logger) {
        var dbType = PersistObjectTemplate.getDB(PersistObjectTemplate.getDBAlias(template.__collection__)).type;
        var prefix = PersistObjectTemplate.dealias(template.__collection__);
        return dbType == PersistObjectTemplate.DB_Mongo ?
            PersistObjectTemplate.getPOJOFromMongoQuery(template, query, options, logger) :
            PersistObjectTemplate.getPOJOsFromKnexQuery(template, [], query, options, undefined, logger).then(function (pojos) {
                pojos.forEach(function (pojo) {
                    _.map(pojo, function(_val, prop) {
                        if (prop.match(RegExp('^' + prefix + '___'))) {
                            pojo[prop.replace(RegExp('^' + prefix + '___'), '')] = pojo[prop];
                            delete pojo[prop];
                        }
                    });
                });
                return pojos;
            });
    }

};
