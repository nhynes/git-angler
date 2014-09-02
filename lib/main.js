/*
    git-angler: a Git event bus
    Copyright (C) 2014 Nick Hynes

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

function getMountPoint( mountPoint, defaultMountPoint ) {
    // TODO: split and package the event bus as middleware. this will go away
    var TRAILING_SLASH = /\/$/;
    return ( mountPoint || defaultMountPoint ).replace( TRAILING_SLASH, '' );
}

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


function getUrlComponents( url, mountPoint ) {
    var parsedUrl,
        TRAILING_SLASH = /\/$/;
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
        reqData = req,
        urlComps = getUrlComponents.bind( null, req.url );

    if ( contentEncoding === 'gzip' || contentEncoding === 'deflate' ) {
        reqData = req.pipe( zlib.createUnzip() );
    }

    if ( reposMountPointRe.test( req.url ) ) {
        gitBackend( reqData, res, urlComps( reposMountPointRe ), EventBus );
    } else if ( hooksMountPointRe.test( req.url ) ) {
        res.write( hooksMountPoint );
        res.end();
    } else {
        githookEndpoint();
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
