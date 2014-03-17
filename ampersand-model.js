var Statey = require('statey');
var _ = require('underscore');
var sync = require('ampersand-sync');


module.exports = Statey.extend({
  save: function (key, val, options) {
    var attrs, method, xhr, attributes = this.attributes;

    // Handle both `"key", value` and `{key: value}` -style arguments.
    if (key == null || typeof key === 'object') {
      attrs = key;
      options = val;
    } else {
      (attrs = {})[key] = val;
    }

    options = _.extend({validate: true}, options);

    // If we're not waiting and attributes exist, save acts as
    // `set(attr).save(null, opts)` with validation. Otherwise, check if
    // the model will be valid when the attributes, if any, are set.
    if (attrs && !options.wait) {
      if (!this.set(attrs, options)) return false;
    } else {
      if (!this._validate(attrs, options)) return false;
    }

    // After a successful server-side save, the client is (optionally)
    // updated with the server-side state.
    if (options.parse === void 0) options.parse = true;
    var model = this;
    var success = options.success;
    options.success = function (resp) {
      var serverAttrs = model.parse(resp, options);
      if (options.wait) serverAttrs = _.extend(attrs || {}, serverAttrs);
      if (_.isObject(serverAttrs) && !model.set(serverAttrs, options)) {
        return false;
      }
      if (success) success(model, resp, options);
      model.trigger('sync', model, resp, options);
    };
    wrapError(this, options);

    method = this.isNew() ? 'create' : (options.patch ? 'patch' : 'update');
    if (method === 'patch') options.attrs = attrs;
    // if we're waiting we haven't actually set our attributes yet so
    // we need to do make sure we send right data
    if (options.wait) options.attrs = _.extend(model.serialize(), attrs);
    xhr = this.sync(method, this, options);

    return xhr;
  },

  // Fetch the model from the server. If the server's representation of the
  // model differs from its current attributes, they will be overridden,
  // triggering a `"change"` event.
  fetch: function (options) {
    options = options ? _.clone(options) : {};
    if (options.parse === void 0) options.parse = true;
    var model = this;
    var success = options.success;
    options.success = function (resp) {
      if (!model.set(model.parse(resp, options), options)) return false;
      if (success) success(model, resp, options);
      model.trigger('sync', model, resp, options);
    };
    wrapError(this, options);
    return this.sync('read', this, options);
  },

  // Destroy this model on the server if it was already persisted.
  // Optimistically removes the model from its collection, if it has one.
  // If `wait: true` is passed, waits for the server to respond before removal.
  destroy: function (options) {
    options = options ? _.clone(options) : {};
    var model = this;
    var success = options.success;

    var destroy = function () {
      model.trigger('destroy', model, model.collection, options);
    };

    options.success = function (resp) {
      if (options.wait || model.isNew()) destroy();
      if (success) success(model, resp, options);
      if (!model.isNew()) model.trigger('sync', model, resp, options);
    };

    if (this.isNew()) {
      options.success();
      return false;
    }
    wrapError(this, options);

    var xhr = this.sync('delete', this, options);
    if (!options.wait) destroy();
    return xhr;
  },

  // Proxy `ampersand-sync` by default -- but override this if you need
  // custom syncing semantics for *this* particular model.
  sync: function () {
    return sync.apply(this, arguments);
  },

  // serialize does nothing by default
  serialize: function () {
    return this._getAttributes(false, true);
  },

  // Remove model from the registry and unbind events
  remove: function () {
    if (this.getId() && this.registry) {
      _.result(this, 'registry').remove(this.type, this.getId(), this._namespace);
    }
    this.trigger('remove', this);
    this.off();
    return this;
  },

  // A model is new if it has never been saved to the server, and lacks an id.
  isNew: function () {
    return this.getId() == null;
  },

  // Default URL for the model's representation on the server -- if you're
  // using Backbone's restful methods, override this to change the endpoint
  // that will be called.
  url: function () {
    var base = _.result(this, 'urlRoot') || _.result(this.collection, 'url') || urlError();
    if (this.isNew()) return base;
    return base + (base.charAt(base.length - 1) === '/' ? '' : '/') + encodeURIComponent(this.getId());
  },

  // get HTML-escaped value of attribute
  escape: function (attr) {
    return _.escape(this.get(attr));
  },

  // convenience methods for manipulating array properties
  addListVal: function (prop, value, prepend) {
    var list = _.clone(this[prop]) || [];
    if (!_(list).contains(value)) {
      list[prepend ? 'unshift' : 'push'](value);
      this[prop] = list;
    }
    return this;
  },

  removeListVal: function (prop, value) {
    var list = _.clone(this[prop]) || [];
    if (_(list).contains(value)) {
      this[prop] = _(list).without(value);
    }
    return this;
  },

  hasListVal: function (prop, value) {
    return _.contains(this[prop] || [], value);
  },

  // Check if the model is currently in a valid state.
  isValid: function (options) {
    return this._validate({}, _.extend(options || {}, { validate: true }));
  }
});


// Throw an error when a URL is needed, and none is supplied.
var urlError = function () {
  throw new Error('A "url" property or function must be specified');
};

// Wrap an optional error callback with a fallback error event.
var wrapError = function (model, options) {
  var error = options.error;
  options.error = function (resp) {
    if (error) error(model, resp, options);
    model.trigger('error', model, resp, options);
  };
};