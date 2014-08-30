var http = require('http'),
    Url = require('url'),
    redis = require('redis'),
    gitBackend = require('./git_http_backend'),
    githookEndpoint = require('./githook_endpoint'),
    config = require('./config'),
    // rpub = redis.createClient(),
    server,
    TRAILING_SLASH = /\/$/,
    reposMountPoint = ( config.reposMountPoint || '/repos' ).replace( TRAILING_SLASH, '' ),
    hooksMountPoint = ( config.hooksMountPoint || '/hooks' ).replace( TRAILING_SLASH, '' ),
    reposMountPointRe = new RegExp( '^' + reposMountPoint + '(/|$)' ),
    hooksMountPointRe = new RegExp( '^' + hooksMountPoint + '(/|$)' );

function getUrlComponents( url, mountPoint ) {
    var parsedUrl;
    if ( !(mountPoint instanceof RegExp ) ) {
        mountPoint = new RegExp( '^' + mountPoint.replace( TRAILING_SLASH, '' ) + '(/|$)' );
    }

    url = url.replace( mountPoint, '/' );
    parsedUrl = Url.parse( url, true );
    return {
        path: parsedUrl.pathname.split('/').slice( 1 ), // remove the initial /
        query: parsedUrl.query,
        url: url
    };
}

server = http.createServer( function( req, res ) {
    if ( reposMountPointRe.test( req.url ) ) {
        gitBackend( req, res, getUrlComponents( req.url, reposMountPointRe ) );
    } else if ( hooksMountPointRe.test( req.url ) ) {
        res.write( hooksMountPoint );
        res.end();
    } else {
        res.writeHead( 404 );
        res.end();
    }
});

server.listen( config.port || 4242 );
