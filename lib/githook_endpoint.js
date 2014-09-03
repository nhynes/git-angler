var url = require('url'),
    utils = require('./utils');

function bufferBody( req, cb ) {
    var chunks = [],
        totalLen = 0;

    req.on( 'data', function( chunk ) {
        chunks.push( chunk );
        totalLen += chunk.length;
    });

    req.on( 'error', function( err ) {
        cb( null, err );
    });

    req.on('end', function() {
        cb( Buffer.concat( chunks ).toString(), totalLen );
    });
}

module.exports = function( opts ) {
    var eventBus = opts.eventBus,
        hookHandlers,
        handlerTimeoutLen = opts.handlerTimeoutLen || 30000,
        callHandlerSync = utils.callHandlerSync.bind( null, eventBus, handlerTimeoutLen );


    hookHandlers = {
        'pre-commit': function( repo, logMsg, res ) {
            var cbArgs = [ { logMsg: logMsg } ];
            callHandlerSync( repo, 'pre-commit', cbArgs, function( exitCode ) {
                eventBus.triggerListeners( repo, 'pre-commit', cbArgs );
                res.end( exitCode ? exitCode.toString() : '0' );
            });
        },
        commit: function( repo, _, res ) {
            eventBus.trigger( repo, 'commit' );
            res.end();
        },
        checkout: function( repo, data, res ) {
            var params = data.split('\n'),
                cbArgs = [ {
                    prevHead: params[ 0 ],
                    newHead: params[ 1 ],
                    chBranch: !!params[ 2 ]
                } ];
            eventBus.trigger( repo, 'checkout', cbArgs );
            res.end();
        },
        merge: function( repo, wasSquash, res ) {
            eventBus.trigger( repo, 'merge', [ { wasSquash: ( wasSquash === 'true' ) } ] );
            res.end();
        },
        'pre-receive': function( repo, updatedRefs, res ) {
            var cbArgs = [ updatedRefs.trim().split('\n').map( function( updateInfo ) {
                var updateParams = updateInfo.split(' ');
                return {
                    old: updateParams[ 0 ],
                    new: updateParams[ 1 ],
                    name: updateParams[ 2 ]
                };
            }) ];
            callHandlerSync( repo, 'pre-receive', cbArgs, function( exitCode ) {
                eventBus.triggerListeners( repo, 'pre-receive', cbArgs );
                res.end( exitCode ? exitCode.toString() : '0' );
            });
        },
        receive: function( repo, updatedRefs, res ) {
            eventBus.trigger( repo, 'receive', [ { updatedRefs: updatedRefs } ] );
            res.end();
        }
    };

    return function( req, res ) {
        if ( req.method !== 'POST' ) {
            res.writeHead( 405, 'Unsupported method on POST only resource' );
            res.end();
            return;
        }

        var parsedUrl = url.parse( req.url, true ),
            hookType = parsedUrl.query.hook,
            repoPathStr = '/' + utils.getRepoPath( parsedUrl.query.repo ).join('/');

        if ( parsedUrl.pathname === '/' ) {
            if ( hookHandlers[ hookType ] ) {
                bufferBody( req, function( body ) {
                    hookHandlers[ hookType ]( repoPathStr, body, res );
                });
            } else if ( hookType ) {
                res.writeHead( 400, 'Invalid hook type' );
                res.end();
            } else {
                res.writeHead( 400, 'Required query parameter: hook' );
                res.end();
            }
        } else {
            res.writeHead( 404 );
            res.end();
        }
    };
};
