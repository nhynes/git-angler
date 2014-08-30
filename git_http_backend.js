var gitHttpBackend = require('git-http-backend'),
    util = require('util'),
    stream = require('stream'),
    spawn = require('child_process').spawn,
    path = require('path'),
    config = require('./config'),
    GIT_HTTP_PATH = '/info/refs'.split('/').slice( 1 ),
    HAVE_RE = /[0-9A-Fa-f]{4}have [0-9A-Fa-f]+/;

/**
 * Gets the repo path from a path containing internal Git subdirectories
 * Looking for a .git directory is unreliable since it may not be a bare repo (i.e. a work tree)
 * @param {Array} path an array containing the repository path
 * @return {Array} the path array to the repo base (and not the internal Git dirs)
 */
function getRepoPath( path ) {
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
    pathStr = path.join('/'),
    i,
    re;
    for ( i = 0; i < REPO_DIRS.length; i++ ) {
        re = REPO_DIRS[ i ];
        if ( re.test( pathStr ) ) {
            return pathStr.replace( re, '' ).split('/');
        }
    }
    return path;
}

util.inherits( ServiceActionChecker, stream.Transform );
/**
 * Checks a Git pack input stream to determine the most likely action type
 * @param Object options serviceAction is the initial guess, other options are passed to Transform
 * When finished streaming, check this.serviceAction for the gathered service action
 */
function ServiceActionChecker( options ) {
    if ( !( this instanceof ServiceActionChecker ) )
        return new ServiceActionChecker( options );

    this.serviceAction = ( options.serviceAction === 'pull' ? 'clone' : options.serviceAction );
    delete options.serviceAction;

    stream.Transform.call( this, options );
}

ServiceActionChecker.prototype._transform = function( chunk, enc, done ) {
    if ( HAVE_RE.test( chunk.toString() ) && this.serviceAction === 'clone' ) {
        this.serviceAction = 'pull';
    }
    this.push( chunk );
    done();
}

module.exports = function( req, res, urlComponents, rpub ) {
    var repoPath = getRepoPath( urlComponents.path ),
        repoFullPath = path.resolve
            .bind( null, config.pathToRepos )
            .apply( null, repoPath ),
        actionNotifier = new stream.PassThrough(),
        serviceActionChecker,
        packStream;

    packStream = req.pipe( gitHttpBackend( req.url, function( err, service ) {
        var ps;

        if ( err ) {
            res.writeHead( 500 );
            res.end( err );
            return;
        }

        res.setHeader( 'Content-Type', service.type );

        serviceActionChecker = new ServiceActionChecker({ serviceAction: service.action });

        ps = spawn( service.cmd, service.args.concat( repoFullPath ) );
        ps.stdout.pipe( service.createStream() ).pipe( serviceActionChecker ).pipe( ps.stdin );
    }) ).pipe( actionNotifier ).pipe( res );

    actionNotifier.on( 'end', function() {
        var action = serviceActionChecker.serviceAction;
    });
};
