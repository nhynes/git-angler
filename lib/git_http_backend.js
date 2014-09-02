/*
    git-angler: a Git event bus
    Copyright (C) 2014 Nick Hynes -- GNU AGPL v3
*/

'use strict';

var fs = require('fs'),
    gitHttpBackend = require('git-http-backend'),
    path = require('path'),
    spawn = require('child_process').spawn,
    stream = require('stream'),
    url = require('url');

/**
 * Gets the repo path from a path containing internal Git subdirectories
 * Looking for a .git directory is unreliable since it may not be a bare repo (i.e. a work tree)
 * @param {String} repoUrlPath a String containing the repository URL
 * @return {Array} the path array to the repo base (and not the internal Git dirs)
 */
function getRepoPath( repoUrlPath ) {
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
    i,
    re,
    dicePath = function( p ) { return p.split('/').slice( 1 ); }; // slice to remove first /
    for ( i = 0; i < REPO_DIRS.length; i++ ) {
        re = REPO_DIRS[ i ];
        if ( re.test( repoUrlPath ) ) {
            return dicePath( repoUrlPath.replace( re, '' ) );
        }
    }
    return dicePath( repoUrlPath );
}

module.exports = function( opts ) {
    opts = opts || {};
    if ( !opts.pathToRepos || !opts.eventBus ) {
        throw Error('git-angler backend requires both a path to repos and an eventBus');
    }
    var eventBus = opts.eventBus,
        pathToRepos = opts.pathToRepos,
        handlerTimeoutLen = opts.handlerTimeoutLen || 30000;

    return function( req, res ) {
        var repoPath = getRepoPath( url.parse( req.url ).pathname ),
            repoPathStr = '/' + repoPath.join('/'),
            repoFullPath = path.resolve.bind( null, pathToRepos ).apply( null, repoPath ),
            actionNotifier = new stream.PassThrough(),
            gitBackend,
            gitService;

        function callHandlerSync( action, args, cb ) {
            var handlerTimeout,
                doneCB = function() {
                    var args = Array.prototype.slice.call( arguments );
                    clearTimeout( handlerTimeout );
                    cb.apply( null, args );
                };

            if ( eventBus.triggerHandler( repoPathStr, action, args.concat( doneCB ) ) ) {
                handlerTimeout = setTimeout( doneCB, handlerTimeoutLen );
            } else {
                doneCB();
            }
        }

        function createBackend( serviceHook ) {
            return gitHttpBackend( req.url, function( err, service ) {
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
                callHandlerSync( 'pre-' + action, cbArgs, function( responseText ) {
                    var sideband;
                    if ( action === 'info' && responseText ) {
                        sideband = service.createBand();
                        sideband.end( responseText );
                    }
                    eventBus.triggerListeners( repoPathStr, 'pre-' + action, [ service.fields ] );
                    done();
                });
            });
            req.bodyStream.pipe( gitBackend ).pipe( actionNotifier ).pipe( res );
        } catch ( e ) {
            if ( e.code === 'ENOENT' ) {
                callHandlerSync( '404', [ {} ], function( clonable, responseText ) {
                    if ( clonable ) {
                        gitBackend = createBackend( function( service, done ) {
                            var sideband;
                            if ( service.action === 'info' && responseText ) {
                                sideband = service.createBand();
                                sideband.end( responseText );
                            }
                            eventBus.triggerListeners( repoPathStr, '404' );
                            done();
                        });
                        req.bodyStream.pipe( gitBackend ).pipe( actionNotifier ).pipe( res );
                    } else {
                        res.writeHead(404);
                        res.end();
                    }
                });
            } else {
                throw e;
            }
        }

        actionNotifier.on( 'end', function() {
            callHandlerSync( gitService.action, [ gitService.fields ], function() {
                eventBus.triggerListeners( repoPathStr, gitService.action, [ gitService.fields ] );
            });
        });
    };
};
