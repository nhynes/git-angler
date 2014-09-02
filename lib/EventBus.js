/**
 * Selects a sub-collection of a given collection based on a selector and the wildcard
 * @param {Object|Array} collection the collection from which to select items
 * @param {String} selector the selector
 * @return {Array} the selected items ordered by scoping from largest to smallest
 * The returned array has the property `select` that is this function bound to the selection
 */
function select( collection, selector ) {
    var selection = [];
    if ( collection instanceof Array ) {
        selection = collection.map( function( item ) {
            return ( item['*'] || item[ selector ] ? select( item, selector ) : item );
        });
        selection = Array.prototype.concat.apply( [], selection );
    } else {
        selection = [].concat( collection['*'], collection[ selector ] )
            .filter( function( selection ) {
                return !!selection;
            });
    }
    selection.select = select.bind( null, selection );
    return selection;
}

var eventbus = {
    /**
     * Adds a listener for the scoped event
     * @param {String} scope the scope/namespace of the event. '*' scope is global.
     * @param {String} event the event name. '*' is all events.
     * @param {Function} cb the callback to be run when the scoped event is triggered
     *
     * All listeners will be called on event trigger (i.e. there is no scoping precedence)
     */
    addEventListener: function( scope, event, cb ) {
        this._listeners[ scope ] = this._listeners[ scope ] || {};
        this._listeners[ scope ][ event ] = this._listeners[ scope ][ event ] || [];
        this._listeners[ scope ][ event ].push( cb );
    },

    /**
     * Sets the single handler for the scoped event
     * @param {String} scope the scope/namespace of the event. '*' scope is global.
     * @param {String} event the event name. '*' is all events.
     * @param {Function} cb the callback to be run when the scoped event is triggered
     * @return {Function} the previously registered event handler
     *
     * The precedence of event handlers is: *::_, _::*, _::_
     * where * is all/global, :: denotes namespacing, and _ is some string
     */
    setEventHandler: function( scope, event, cb ) {
        var prevHandler;
        this._handlers[ scope ] = this._handlers[ scope ] || {};
        prevHandler = this._handlers[ scope ][ event ];
        this._handlers[ scope ][ event ] = cb;
        return prevHandler;
    },

    /**
     * Removes a listener previously registered with the *exact* scope, event, and callback
     * @param {String} scope the event's scope
     * @param {String} event the event's name
     * @param {Function} cb the previously registered function
     * @return {Boolean} whether or not a listener was removed
     */
    removeEventListener: function( scope, event, cb ) {
        var listeners;
        if ( this._listeners[ scope ] && this._listeners[ scope ][ event ] ) {
            listeners = this._listeners[ scope ][ event ];
            this._listeners[ scope ][ event ] = listeners.filter( function( callback ) {
                return callback.toString() !== cb.toString();
            });
            return this._listeners[ scope ][ event ].length !== listeners.length;
        }
    },

    /**
     * Triggers the event handler for the scoped event
     * @param {String} scope the scope/namespace of the event. '*' scope is global.
     * @param {String} event the event name. '*' is all events.
     * @param {Array} args the arguments to be passed to the listener callback
     * @return {Boolean} whether or not a handler was called
     */
    triggerHandler: function( scope, event, args ) {
        var handler = select( this._handlers, scope ).select( event )[0],
            infoedArgs = [ scope, event ].concat( args );
        if ( handler && handler.apply ) { handler.apply( null, infoedArgs ); }
        return handler && handler.apply;
    },

    /**
     * Triggers the event listeners' callbacks for the scoped event
     * @param {String} scope the scope/namespace of the event. '*' scope is global.
     * @param {String} event the event name. '*' is all events.
     * @param {Array} args the arguments to be passed to the listener callbacks
     *     the scope and event are prepended to the argument list
     * @return {Boolean} whether or not a listener was called
     */
    triggerListeners: function( scope, event, args ) {
        var listeners = select( this._listeners, scope ).select( event ),
            infoedArgs = [ scope, event ].concat( args );
        listeners.map( function( listener ) {
            if ( listener.apply ) { listener.apply( null, infoedArgs ); }
        });
        return listeners.length !== 0;
    },

    /**
     * Triggers both the event listeners and event handler for the scoped event
     * @param {String} scope the scope/namespace of the event. '*' scope is global.
     * @param {String} event the event name. '*' is all events.
     * @param {Array} args the arguments to be passed to the listener/handler callbacks
     *     the scope and event are prepended to the argument list
     * @return {Boolean} whether or not a listener or handler was called
     */
    trigger: function() {
        var thisArgs = Array.prototype.slice.call( arguments ),
            handlerCalled = this.triggerHandler.apply( this, thisArgs ),
            listenerCalled = this.triggerListeners.apply( this, thisArgs );
        return handlerCalled || listenerCalled;
    }
};


function EventBus() {
    var self = ( this instanceof EventBus ? this : Object.create( eventbus ) );
    self._listeners = {};
    self._handlers = {};
    return self;
}

EventBus.prototype = eventbus;

module.exports = EventBus;
