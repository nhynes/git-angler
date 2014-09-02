'use strict';

var http = require('http'),
    zlib = require('zlib'),
    net = require('net'),
    Url = require('url'),
    dnode = require('dnode'),
    gitBackend = require('./git_http_backend'),
    githookEndpoint = require('./githook_endpoint'),
    EventBus = require('./EventBus')(),
    shoe = require('shoe'),
    config = require('./config'),
    server,
    eventBusRPCs,
    eventServer,
    wsEventServer,
    reposMountPoint = getMountPoint( config.reposMountPoint, '/repos' ),
    hooksMountPoint = getMountPoint( config.hooksMountPoint, '/hooks' ),
    eventsMountPoint = getMountPoint( config.eventsMountPoint, '/events' ),
    reposMountPointRe = new RegExp( '^' + reposMountPoint + '(/|$)' ),
    hooksMountPointRe = new RegExp( '^' + hooksMountPoint + '(/|$)' );

function getMountPoint( mountPoint, defaultMountPoint ) {
    // TODO: split and package the event bus as middleware. this will go away
    var TRAILING_SLASH = /\/$/;
    return ( mountPoint || defaultMountPoint ).replace( TRAILING_SLASH, '' );
}

function getUrlComponents( url, mountPoint ) {
    var parsedUrl;
    if ( !(mountPoint instanceof RegExp ) ) {
        mountPoint = new RegExp( '^' + mountPoint.replace( TRAILING_SLASH, '' ) + '(/|$)' );
    }

    url = url.replace( mountPoint, '/' );
    parsedUrl = Url.parse( url, true );
    return {
        path: parsedUrl.pathname.split('/').slice( 1 ), // slice off the initial slash
        query: parsedUrl.query,
        url: url
    };
}

server = http.createServer( function( req, res ) {
    var contentEncoding = req.headers['content-encoding'],
        reqData = req;

    if ( contentEncoding === 'gzip' || contentEncoding === 'deflate' ) {
        reqData = req.pipe( zlib.createUnzip() );
    }

    var urlComps = getUrlComponents.bind( null, req.url );
    if ( reposMountPointRe.test( req.url ) ) {
        gitBackend( reqData, res, urlComps( reposMountPointRe ), EventBus );
    } else if ( hooksMountPointRe.test( req.url ) ) {
        res.write( hooksMountPoint );
        res.end();
    } else {
        res.writeHead( 404 );
        res.end();
    }
}).listen( config.port || 4242 );

eventBusRPCs = {
    addEventListener: EventBus.addEventListener,
    setEventHandler: EventBus.setEventHandler,
    removeEventListener: EventBus.removeEventHandler
};

eventServer = net.createServer( function( socket ) {
    var d = dnode( eventBusRPCs );
    socket.pipe( d ).pipe( socket );
});

wsEventServer = shoe( function( stream ) {
    var d = dnode( eventBusRPCs );
    d.pipe( stream ).pipe( d );
});
wsEventServer.install( server, eventsMountPoint );
