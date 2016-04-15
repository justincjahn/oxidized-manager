/* global Backbone:false, $:false, _:false */

var app = {
  Collections:  {},
  Controllers:  {},
  Models:       {},
  Views:        {}
};

(function () {
  "use strict";

  /**
   * A custom `Backbone.View` class.
   *
   * @class app.View
   */
  app.View = Backbone.View.extend({});

  /**
   * A custom `Backbone.Modal` class that allows us to fetch form values a little easier.  Unfortunately,
   * jQuery's `serialize()` function doesn't allow one to choose which empty fields to include.
   *
   * @class app.Modal
   */
  app.Modal = Backbone.Modal.extend({
    /**
     * Fetch the form values from the DOM and return it as a JSON hash.
     *
     * @param {Array|true} allowEmpty - An array of input names to allow empty values.  Specifying true allows all empty fields.
     */
    getFormValues: function(allowEmpty)
    {
      // Set the default value to an empty array
      allowEmpty = allowEmpty || [];

      // The return array
      var data = {};

      /**
       * Determine if the caller has allowed an empty value for the given input name.
       *
       * @param {String} name - The name of the input in question.
       * @return {Boolean} - If the value should be processed, even if it's empty.
       */
      var allow = function (name) {
        if (allowEmpty === true) {
          return true;
        }

        if ($.inArray(name, allowEmpty) == -1) {
          return false;
        }

        return true;
      };

      // Loop through every input in the form, and fetch their values.
      this.$el.find(':input').each(function (item) {
        var value = $(this).val();
        var name  = $(this).attr('name');

        // If the form field doesn't have a name, then skip it
        if (!name) { return; }

        // If the length is zero, and the user hasn't allowed it as an empty field
        if (value.length === 0 && !allow(name)) { return; }

        // Add the data to our return object
        data[name] = value;
      });

      return data;
    }
  });

  /**
   * Override the `save` method to allow models the ability to restrict which fields are sent to the
   * server when saving.
   */
  app.Model = Backbone.Model.extend({
    /**
     * Override the default behavior of `Backbone.Model.save()` to allow users the ability to provide
     * a list of attributes that may be sent to the server.  Introduces the attribute `serverAttributes`.
     */
    save: function (attrs, options) {
      // Default value for attrs
      attrs = attrs || {};
      if (_.isEmpty(attrs)) {
        attrs = this.toJSON();
      }

      // Default value for options
      options = options || {};

      // If model defines serverAttrs, replace attrs with trimmed version
      if (this.serverAttributes) {
        attrs = _.pick(attrs, this.serverAttributes);
      }

      // Move attrs to options
      options.attrs = attrs;

      // Call super with attrs moved to options
      Backbone.Model.prototype.save.call(this, attrs, options);
    }
  });

  /**
   * A singleton wrapper to make sure only one User is active.
   */
  app.Models.User = (function () {
    var model;

    /**
     * Represents the client user.
     *
     * @class app.Models.User
     */
    var _model = Backbone.Model.extend({
      defaults: {
        loggedIn:    false,
        displayName: 'Guest'
      }
    });

    return function () {
      if (!model) {
        model = new _model();
      }

      return model;
    };
  })();

  /**
   * Represents a network device.
   *
   * @class app.Models.Device
   */
  app.Models.Device = app.Model.extend({
    urlRoot: '/devices',

    url: function () {
      if (this.isNew()) {
        return this.urlRoot;
      } else {
        return this.urlRoot + '/' + this.id;
      }
    },

    validation: {
      name: {
        required:  true,
        minLength: 3
      },

      type: {
        required:  true,
        minLength: 3
      },

      address: {
        required:  true
      },

      username: {
        required: true
      },

      password: {
        required: function () {
          return this.isNew();
        }
      },

      enable: {
        required: false
      }
    },

    serverAttributes: [
      'name',
      'type',
      'address',
      'username',
      'password',
      'enable'
    ],

    defaults: {
      name:         null,
      type:         'ios',
      address:      null,
      username:     null,
      password:     null,
      enable:       null,
      created_at:   null,
      updated_at:   null,
      status:       'never',
      last_attempt: 'never'
    }
  });

  /**
   * A singleton wrapper to make sure only one Device collection may be active.
   */
  app.Collections.Device = (function () {
    var collection;

    /**
     * Represents a collection of `app.Models.Device` objects.
     *
     * @class app.Collections.Device
     */
    var _collection = Backbone.Collection.extend({
      model: app.Models.Device,
      url:   '/devices'
    });

    return function () {
      if (!collection) {
        collection = new _collection();
      }

      return collection;
    };
  })();

  /**
   * A View which renders out errors as a list.
   */
  app.Views.Alert = Backbone.View.extend({
    errors:    [],
    tagName:   'ul',
    className: 'errors',

    /**
     * Set the content, and render it to the provided element.
     *
     * @param {Array[String]} errors - A list of errors to render.
     * @param {HTMLElement} element - The element to render inside of.
     */
    set: function (errors, element) {
      this.errors = errors;
      this.render();
      $(element).html(this.$el);
    },

    render: function () {
      var self = this;

      this.$el.empty();
      _.each(this.errors, function (error) {
        self.$el.append('<li>' + error + '</li>');
      });
    }
  });

  /**
   * A View that renders a confirmation dialog. The dialog may be bound using the `modal:confirm`
   * and `modal:cancel` events.
   *
   * @class app.Views.ConfirmModal
   */
  app.Views.ConfirmModal = app.Modal.extend({
    template: _.template($('#template-ConfirmModal').html()),
    cancelEl: '.bbm-button',

    events: {
      'click .modal-confirm': 'confirm',
      'click .modal-cancel': 'cancel'
    },

    confirm: function () {
      this.trigger('modal:confirm');
    },

    cancel: function () {
      this.trigger('modal:cancel');
    }
  });

  /**
   * A View that renders a confirmation dialog, and calls the backend to reload the device list.
   *
   * @class app.Views.ReloadModal
   */
  app.Views.ReloadModal = app.Modal.extend({
    /**
     * `Backbone.Modal` property that specifies the selector for a cancel element.
     */
    cancelEl: '.modal-cancel',

    /**
     * The template used when rendering.
     */
    template: _.template($('#template-ReloadModal').html()),

    events: {
      'click .modal-confirm': 'submit'
    },

    /**
     * Work around `Backbone.Modal` automatically closing the window when the submit button is pressed.
     */
    beforeSubmit: function (e)
    {
      // If this was called by Backbone.Modal, and the Enter key was pressed,
      /// stop it, and fire our submit method manually.
      ///
      /// @note Backbone.Modal should support promises...
      if (e && e.keyCode === 13) {
        this.submit(e);
        return false;
      }

      return true;
    },

    /**
     * Fetch data from the form fields, and save them to the server.  Once we're
     * done, re-render the row as it was.
     */
    submit: function (e)
    {
      var self = this;

      // Prevent the events from bubbling up
      if (e) { e.preventDefault(); }

      // Disable the ok button
      this.$('.modal-confirm').attr('disabled', 'disabled');

      // Call the backend
      $.ajax({
        url:  '/devices/reload',
        type: 'get'
      }).done(function (data, textStatus, jqXHR) {
        // Trigger the confirm
        self.trigger('modal:confirm');

        // Destroy the modal
        self.destroy();
      }).fail(function (jqXHR, textStatus, errorThrown) {
        if (jqXHR.responseJSON) {
          self.$('.error').html('<p>' + jqXHR.responseJSON.error + '</p>');
        } else {
          self.$('.error').html('<p>An unknown error has occurred.</p>');
        }
      }).always(function () {
        self.$('.modal-confirm').attr('disabled', null);
      });
    },

    /**
     * Cancel the modal window, and fire an event to those who wish to act on it.
     */
    cancel: function (e)
    {
      // Reset the model with the data we had originally
      this.trigger('modal:cancel');
    }
  });

  /**
   * A View that renders a basic login page, and submits credentials to the backend.
   *
   * @class app.Views.Login
   */
  app.Views.Login = app.View.extend({
    view:     'Login',
    template: $('#template-Login').html(),

    events: {
      'click #form-login-submit': 'login'
    },

    /**
     * Lazy load the view template, generate HTML, and render it out.
     */
    render: function () {
      this.$el.html(this.template);
    },

    /**
     * Attempt to log the user in.
     */
    login: function (e) {
      var self = this;
      var data = $('#form-login').serializeArray();

      e.preventDefault();

      // Disable the submit form until we receive a response
      self.$('#form-login-submit').attr('disabled', 'disabled');

      $.ajax({
        url:      '/login',
        type:     'post',
        dataType: 'json',
        data:     data
      }).done(function (data, textStatus, jqXHR) {
        app.Models.User().set('loggedIn', true);
        app.Models.User().set('displayName', data.displayName);

        // Send the user to the home page
        window.location.replace('#');
      }).fail(function (jqXHR, textStatus, errorThrown) {
        if (jqXHR.responseJSON) {
          self.$('.error').html('<p>' + jqXHR.responseJSON.error + '</p>');
        } else {
          self.$('.error').html('<p>An unknown error has occurred.</p>');
        }
      }).always(function () {
        self.$('#form-login-submit').attr('disabled', null);
      });
    }
  });

  /**
   * A View that renders a form allowing users to add or edit `Device` models. The dialog may be
   * listened to using the `modal:confirm` and `modal:cancel` events.
   *
   * @class app.Views.DeviceModal
   */
  app.Views.DeviceModal = app.Modal.extend({
    /**
     * `Backbone.Modal` property that specifies the selector for a cancel element.
     */
    cancelEl: '.modal-cancel',

    /**
     * The model to be modified.
     */
    model: null,

    /**
     * Used to store model information before any changes can be made.  Allows canceling after
     * validation on keystroke.
     */
    data: null,

    /**
     * The template used when rendering.
     */
    template: _.template($('#template-DeviceModal').html()),

    /**
     * A view used show any errors with the form.
     */
    alertView: new app.Views.Alert(),

    events: {
      'click .modal-confirm': 'submit',
      'keyup input':          'validate'
    },

    /**
     * Initialize the modal with an empty Device model, and bind the validator to the View.
     *
     * @param {app.Models.Device} [options.model] - The model to edit.  Defaults to new.
     */
    initialize: function (options)
    {
      var self = this;

      // Set the model from options, if provided
      options = options || {};
      this.model = options.model || new app.Models.Device();

      // Monitor the model for validation events to update the model
      this.model.bind('validated', function (isValid, model, errors) {
        var alertElement = self.$('.form-errors');
        self.alertView.set(_.values(errors), alertElement);
      });

      // Save the original data if the user wishes to cancel
      this.data = this.model.toJSON();

      // Setup validation
      Backbone.Validation.bind(this);
    },

    /**
     * Place default data from the model onto the form elements.
     */
    onRender: function ()
    {
      var self = this;

      $.each(this.model.toJSON(), function (key, value) {
        self.$el.find('input[name=' + key + ']').val(value);
      });

      // Prefire the validator
      this.validate();
    },

    /**
     * Makes sure that the data is valid before allowing the user to submit.
     */
    validate: function (e)
    {
      this.model.set(this.getFormValues(true), {silent: true});

      var submitButton = this.$el.find('.modal-confirm');
      if (!this.model.isValid(true)) {
        submitButton.attr('disabled', 'disabled');
      } else {
        submitButton.attr('disabled', null);
      }
    },

    /**
     * Make sure that the data is valid before allowing the user to submit.
     */
    beforeSubmit: function (e)
    {
      // Remove the timing columns if they exist
      this.model.unset('created_at');
      this.model.unset('updated_at');

      // If this was called by Backbone.Modal, and the Enter key was pressed,
      /// stop it, and fire our submit method manually.
      ///
      /// @note Backbone.Modal should support promises...
      if (e) {
        if (e.keyCode === 13) {
          this.submit(e);
          return false;
        }
      }

      return this.model.isValid(true);
    },

    /**
     * Fetch data from the form fields, and save them to the server.  Once we're
     * done, re-render the row as it was.
     */
    submit: function (e)
    {
      var self = this;

      // Prevent the events from bubbling up
      if (e) { e.preventDefault(); }
      
      // Make sure the data is valid before saving
      if (!this.beforeSubmit()) { return false; }

      // Save the model, but cache the new status
      var isNew = this.model.isNew();
      this.model.save({}, {
        success: function (model, response, options) {
          // If the model is new, add it to the device collection
          if (isNew) {
            app.Collections.Device().add(self.model);
          }

          // Clear the model's username and enable as we shouldnt keep those lying about
          self.model.unset('password', {silent: true});
          self.model.unset('enable', {silent: true});

          // Fire a change event on the model because we've been silent until now
          self.model.trigger('change', self.model);

          // Trigger the confirm
          self.trigger('modal:confirm');

          // Destroy the modal
          self.destroy();
        },

        error: function (model, response, options) {
          var alertElement = self.$('.form-errors');
          if (response.status === 500 && response.responseJSON) {
            self.alertView.set(response.responseJSON, alertElement);
          } else {
            self.alertView.set(['An unknown error occurred! ' + response.responseText], alertElement);
          }
        }
      });
    },

    /**
     * Cancel the modal window, and fire an event to those who wish to act on it.
     */
    cancel: function (e)
    {
      // Reset the model with the data we had originally
      this.model.set(this.data);
      this.trigger('modal:cancel');
    }
  });

  /**
   * Represents a single `app.Model.Device` within the DOM.
   *
   * @class app.Views.Device
   */
  app.Views.Device = Backbone.Marionette.ItemView.extend({
    tagName:  'tr',
    template: '#template-Device',

    events: {
      'click .item-edit':   'editItem',
      'click .item-reload': 'reloadItem',
      'click .item-delete': 'deleteItem'
    },

    /**
     * Listen to some model events, and prepare for rendering.
     */
    initialize: function () {
      this.listenTo(this.model, 'change', this.render);
    },

    /**
     * Inject the edit code into the row.
     */
    editItem: function (e) {
      var modal = new app.Views.DeviceModal({model: this.model});
      $('#modal').html(modal.render().el);
    },

    /**
     * Tell the backend to pull configs next opportunity.
     */
    reloadItem: function (e) {
      var self = this;

      $.ajax({
        url:      'devices/reload/' + this.model.get('address'),
        dataType: 'json'
      }).done(function (data) {
        self.model.set('status', self.model.defaults.status);
        self.model.set('last_attempt', self.model.defaults.last_attempt);
      }).fail(function (jqXHR, textStatus) {
        if (jqXHR.responseJSON && jqXHR.responseJSON.error) {
          alert(jqXHR.responseJSON.error);
        } else {
          alert("An unknown error occurred while attempting device refresh.");
          console.log(jqXHR);
        }
      });
    },

    /**
     * Delete an item from the list, after a confirmation prompt.
     */
    deleteItem: function (e) {
      var self  = this;
      var modal = new app.Views.ConfirmModal();

      var options = {
        success: function (model, response) {
          self.remove();
        },

        error: function (model, response) {
          if (response.status === 500) {
            alert('Unable to delete Device. Internal Server Error');
          } else {
            alert('Unable to delete device. HTTP ' + response.status);
          }
        }
      };

      // When the user confirms deletion, perform it
      modal.on('modal:confirm', function () {
        self.model.destroy(options);
      });

      $('#modal').html(modal.render().el);
    }
  });

  /**
   * A view that controls filtering of data.
   */
  app.Views.Filter = Backbone.Marionette.ItemView.extend({
    template: '#template-Filter',

    triggers: {
      'keyup #collection-filter': 'filter'
    },

    /**
     * Fetch the value of the filter input.  We keep this here so the other classes don't need to
     * snoop in on our elements.
     *
     * @return {string}
     */
    getValue: function () {
      return this.$('input').first().val();
    }
  });

  /**
   * A view that contains utility buttons.
   */
  app.Views.UtilityStrip = Backbone.Marionette.ItemView.extend({
    template: '#template-UtilityStrip',

    events: {
      'click #device-add':    'add',
      'click #device-reload': 'reload'
    },

    add: function (e) {
      var modal = new app.Views.DeviceModal();
      $('#modal').html(modal.render().el);
    },

    reload: function (e) {
      var modal = new app.Views.ReloadModal();
      $('#modal').html(modal.render().el);
    }
  });

  /**
   * Represents the `app.Collections.Device` object within the DOM.
   */
  app.Views.DeviceCollection = Backbone.Marionette.CompositeView.extend({
    childView:          app.Views.Device,
    childViewContainer: 'tbody',
    template:           '#template-DeviceCollection',

    /**
     * A some metadata used to determine what the current sort order is.
     */
    _comparator: ['id', true],

    events: {
      'click th[data-sort]': 'sort'
    },

    triggers: {
      'click #device-add': 'device:add'
    },

    /**
     * Update the status of each model periodically.
     *
     * Periodically fetches data from the backend about the status of each device, and loops through
     * the device collection, updating them.  Anything hooked into the model's change events will
     * update.
     *
     * @NOTE: The stats API does not sort events for you.
     */
    updateStatus: function () {
      var self = this;

      $.ajax({
        url:      'devices/status',
        dataType: 'json',

        // We don't want to trigger any login redirects here, just passively update models.
        statusCode: {
          401: null,
          403: null
        }
      }).done(function (data) {
        // Loop through each device in the collection, and attempt to update it's status
        self.collection.each(function (device) {
          var address = device.get('address');

          // The server may not know about this device
          if (data[address]) {
            // Flatten the array for easier sorting
            var deviceStatus = new Array();
            var statuses     = _.keys(data[address]);

            _.each(statuses, function (sStatus) {
              _.each(data[address][sStatus], function (entry) {
                entry.status = sStatus;
                deviceStatus.push(entry);
              });
            });

            // Sort the statuses by date ascending, and pull the last entry
            deviceStatus = _.sortBy(deviceStatus, 'end');
            deviceStatus = deviceStatus.pop();

            // Set the status
            device.set('status', deviceStatus.status);
            device.set('last_attempt', deviceStatus.end);
          }
        });
      }).always(function () {
        setTimeout(function () { self.updateStatus(); }, 10000);
      });
    },

    /**
     * Setup the collection.
     */
    initialize: function (options)
    {
      var self = this;

      if (options && options.filterView) {
        this.filterView = options.filterView;

        this.listenTo(options.filterView, 'filter', function () {
          self.render();
        });
      }

      this.updateStatus();
    },

    /**
     * Filter the selection based on what is currently in the filter text box.
     */
    filter: function (child, index, collection)
    {
      // If we don't have a filterView, skip filtering
      if (!this.filterView) {
        return true;
      }

      // Fetch the filter value from the form input
      var filter = this.filterView.getValue().toLowerCase();

      // The user hasn't entered anything into the box
      if (filter.length === 0) {
        return true;
      }

      // The user has entered something, search fields
      var name = child.get('name').toLowerCase();
      var type = child.get('type').toLowerCase();
      var addr = child.get('address').toLowerCase();
      var user = child.get('username').toLowerCase();

      if (name.indexOf(filter) >= 0) { return true; }
      if (type.indexOf(filter) >= 0) { return true; }
      if (addr.indexOf(filter) >= 0) { return true; }
      if (user.indexOf(filter) >= 0) { return true; }

      // Nothing matched
      return false;
    },

    /**
     * Generate a comparator function for the collection based on the current settings, and the
     * provided sort name.
     *
     * @param {String} name - The name of the column to sort.
     * @return {Function} - A comparator function that will sort as requested.
     */
    generateComparator: function (name)
    {
      var self = this;

      return function (mLeft, mRight) {
        var left    = mLeft.get(name);
        var right   = mRight.get(name);
        var iReturn = 0;

        if (left > right) {
          iReturn = -1;
        }

        if (right > left) {
          iReturn = 1;
        }

        if (!self._comparator[1]) {
          iReturn *= -1;
        }

        return iReturn;
      };
    },

    /**
     * Renders heading symbols based on the current sort criteria, and places the child filter view
     * into the DOM.
     */
    onRender: function ()
    {
      var self = this;

      this.$('th[data-sort]').each(function (index) {
        var fa = $(this).find('.fa');

        if ($(this).attr('data-sort') === self._comparator[0]) {
          if (self._comparator[1]) {
            fa.attr('class', 'fa fa-chevron-up');
          } else {
            fa.attr('class', 'fa fa-chevron-down');
          }
        } else {
          fa.attr('class', 'fa');
        }
      });
    },

    /**
     * Called when the user clicked on a header with a data-sort attribute.
     */
    sort: function (e)
    {
      // Fetch the column name from the DOM
      var name = $(e.currentTarget).attr('data-sort');

      // If the user clicked the same header again, then reverse the sort order
      if (this._comparator[0] === name) {
        this._comparator[1] = !this._comparator[1];
      } else {
        // The user chose a new header
        this._comparator = [name, true];
      }

      // Perform the sorting
      this.collection.comparator = this.generateComparator(name);
      this.collection.sort();
    }
  });

  /**
   * A layout to render out the DeviceCollection, Filter, and UtilityStrip.
   */
  app.Views.Layout = Backbone.Marionette.LayoutView.extend({
    template: '#template-Layout',

    regions: {
      'filter':  '#filter',
      'utility': '#utility',
      'list':    '#collection'
    }
  });

  /**
   * Singleton wrapper to make sure only one router is active.
   */
  app.Router = (function() {
    var router = null;

    /**
     * The application's router.
     */
    var _router = Backbone.Router.extend({
      routes: {
        'login':    'login',
        '*actions': 'defaultRoute'
      },

      /**
       * Show the given view.
       *
       * @param {app.View} view - The view to render.
       */
      show: (function () {
        var currentView = null;

        return function (view) {
          if (currentView) {
            currentView.remove();
          }

          currentView = view;

          currentView.render();
          $("#main").html(currentView.el);
        };
      })(),

      /**
       * Render the main layout of the application.
       */
      defaultRoute: function () {
        var self       = this;
        var collection = app.Collections.Device();

        collection.fetch().done(function () {
          var layout = new app.Views.Layout();
          self.show(layout);

          var filter = new app.Views.Filter();
          layout.showChildView('filter', filter);

          var list = new app.Views.DeviceCollection({collection: collection, filterView: filter});
          layout.showChildView('list', list);

          var utility = new app.Views.UtilityStrip();
          layout.showChildView('utility', utility);
        });
      },

      /**
       * Renders the login form.  This will occur when the server sends an HTTP 401 or 403 message.
       */
      login: function (options) {
        var view = new app.Views.Login();
        this.show(view);
      }
    });

    // Return our singleton function
    return function() {
      if (!router) {
        router = new _router();
      }

      return router;
    };
  })();

  // Requests that return 401 and/or 403 errors are a good indication
  /// that the user needs to login.
  $.ajaxSetup({
    statusCode: {
      401: function () {
        window.location.replace('#login');
      },

      403: function () {
        window.location.replace('#login');
      }
    }
  });
})();

$(function () {
  app.Router();
  Backbone.history.start();
});
