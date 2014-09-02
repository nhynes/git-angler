// TODO: make this component into a stream

'use strict';

var gitHttpBackend = require('git-http-backend'),
    fs = require('fs'),
    stream = require('stream'),
    spawn = require('child_process').spawn,
    path = require('path'),
    config = require('./config'),
    handlerTimeoutLen = config.handlerTimeout || 30000;

/**
 * Gets the repo path from a path containing internal Git subdirectories
 * Looking for a .git directory is unreliable since it may not be a bare repo (i.e. a work tree)
 * @param {Array} path an array containing the repository path
 * @return {Array} the path array to the repo base (and not the internal Git dirs)
 */
function getRepoPath( repoPath ) {
    var REPO_DIRS = [ // @see man gitrepository-layout
        // it might be useful to convert this into a self-organizing list
        /\/git-receive-pack$/,
        /\/git-upload-pack$/,
        /\/info\/refs$/,
        /\/info\/grafts$/,
        /\/info\/exclude$/,
        /\/info$/,
        /\/objects\/[0-9a-f]{2}$/,
        /\/objects\/pack/,
        /\/objects\/info/,
        /\/objects\/info\/packs$/,
        /\/objects\/info\/alternates$/,
        /\/objects\/info\/http-alternates$/,
        /\/objects$/,
        /\/refs\/heads\/.*$/,
        /\/refs\/tags\/.*$/,
        /\/refs\/remotes.*$/,
        /\/refs\/replace\/[0-9a-f]+$/,
        /\/refs$/,
        /\/packed-refs$/,
        /\/HEAD$/,
        /\/branches$/,
        /\/hooks$/,
        /\/index$/,
        /\/remotes$/,
        /\/logs\/refs\/heads\/.*$/,
        /\/logs\/refs\/tags\/.*$/,
        /\/logs$/,
        /\/shallow$/
    ],
    pathStr = repoPath.join('/'),
    i,
    re;
    for ( i = 0; i < REPO_DIRS.length; i++ ) {
        re = REPO_DIRS[ i ];
        if ( re.test( pathStr ) ) {
            return pathStr.replace( re, '' ).split('/');
        }
    }
    return repoPath;
}

module.exports = function( req, res, urlComponents, EventBus ) {
    var repoPath = getRepoPath( urlComponents.path ),
        repoPathStr = '/' + repoPath.join('/'),
        repoFullPath = path.resolve
            .bind( null, config.pathToRepos )
            .apply( null, repoPath ),
        actionNotifier = new stream.PassThrough(),
        gitBackend,
        gitService;

    function callHandlerSync( repo, action, args, cb ) {
        var handlerTimeout,
            doneCB = function() {
                var args = Array.prototype.slice.call( arguments );
                clearTimeout( handlerTimeout );
                cb.apply( null, args );
            };

        if ( EventBus.triggerHandler( repo, action, args.concat( cb ) ) ) {
            handlerTimeout = setTimeout( doneCB, handlerTimeoutLen );
        } else {
            doneCB();
        }
    }

    function createBackend( serviceHook ) {
        return gitHttpBackend( urlComponents.url, function( err, service ) {
            var ps;

            if ( err ) {
                res.writeHead( 500 );
                res.end();
                return;
            }

            res.setHeader( 'Content-Type', service.type );

            gitService = service;

            serviceHook( service, function() {
                ps = spawn( service.cmd, service.args.concat( repoFullPath ) );
                ps.stdout.pipe( service.createStream() ).pipe( ps.stdin );
                ps.stderr.on( 'data', function() {
                    res.writeHead( 500 );
                    res.end();
                });
            });
        });
    }

    try {
        fs.statSync( repoFullPath );
        gitBackend = createBackend( function( service, done ) {
            var action = service.action,
                cbArgs = [ service.fields ];
            callHandlerSync( repoPathStr, 'pre-' + action, cbArgs, function( responseText ) {
                var sideband;
                if ( action === 'info' && responseText ) {
                    sideband = service.createBand();
                    sideband.end( responseText );
                }
                EventBus.triggerListeners( repoPathStr, 'pre-' + action, [ service.fields ] );
                done();
            });
        });
        req.pipe( gitBackend ).pipe( actionNotifier ).pipe( res );
    } catch ( e ) {
        if ( e.code === 'ENOENT' ) {
            callHandlerSync( repoPathStr, '404', [], function( clonable, responseText ) {
                if ( clonable ) {
                    gitBackend = createBackend( function( service, done ) {
                        var sideband;
                        if ( service.action === 'info' && responseText ) {
                            sideband = service.createBand();
                            sideband.end( responseText );
                        }
                        EventBus.triggerListeners( repoPathStr, '404' );
                        done();
                    });
                    req.pipe( gitBackend ).pipe( actionNotifier ).pipe( res );
                } else {
                    res.writeHead(404);
                    res.end();
                }
            });
            return;
        } else {
            throw e;
        }
    }

    actionNotifier.on( 'end', function() {
        callHandlerSync( repoPathStr, gitService.action, [ gitService.fields ], function() {
            EventBus.triggerListeners( repoPathStr, gitService.action, [ gitService.fields ] );
        });
    });
};
