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
    utils = require('./utils'),
    zlib = require('zlib');

module.exports = function( opts ) {
    opts = opts || {};
    if ( !opts.pathToRepos || !opts.eventBus ) {
        throw Error('git-angler backend requires both a path to repos and an eventBus');
    }
    var eventBus = opts.eventBus,
        pathToRepos = opts.pathToRepos,
        handlerTimeoutLen = opts.handlerTimeoutLen || 30000;

    return function( req, res ) {
        var repoPath = utils.getRepoPath( req.url ),
            repoPathStr = '/' + repoPath.join('/'),
            repoFullPath = path.resolve.bind( null, pathToRepos ).apply( null, repoPath ),
            actionNotifier = new stream.PassThrough(),
            backend,
            gitService,
            encoding = req.headers['content-encoding'],
            decompress = ( encoding === 'gzip' || encoding === 'deflate' ?
                          zlib.createUnzip() : stream.PassThrough() ),
            callHandlerSync = utils.callHandlerSync
                .bind( null, eventBus, handlerTimeoutLen, repoPathStr );

        function createBackend( serviceHook ) {
            return gitHttpBackend( req.url, function( err, service ) {
                var ps;

                if ( err ) {
                    res.writeHead( 400 );
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
            backend = createBackend( function( service, done ) {
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
            req.pipe( decompress ).pipe( backend ).pipe( actionNotifier ).pipe( res );
        } catch ( e ) {
            if ( e.code === 'ENOENT' ) {
                callHandlerSync( '404', [ {} ], function( clonable, responseText ) {
                    if ( clonable ) {
                        backend = createBackend( function( service, done ) {
                            var sideband;
                            if ( service.action === 'info' && responseText ) {
                                sideband = service.createBand();
                                sideband.end( responseText );
                            }
                            eventBus.triggerListeners( repoPathStr, '404' );
                            done();
                        });
                        req.pipe( decompress ).pipe( backend ).pipe( actionNotifier ).pipe( res );
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
