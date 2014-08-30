var gitHttpBackend = require('git-http-backend'),
    spawn = require('child_process').spawn,
    path = require('path'),
    config = require('./config'),
    GIT_HTTP_PATH = '/info/refs'.split('/').slice( 1 );

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

module.exports = function( req, res, urlComponents, rpub ) {
    var repoPath = getRepoPath( urlComponents.path ),
        repoFullPath = path.resolve
            .bind( null, config.pathToRepos )
            .apply( null, repoPath )

    req.pipe( gitHttpBackend( req.url, function( err, service ) {
        var ps;

        if ( err ) {
            res.writeHead( 500 );
            res.end( err );
            return;
        }

        res.setHeader( 'Content-Type', service.type );
        console.log( service.action, service.args, service.fields, service.type );

        ps = spawn( service.cmd, service.args.concat( repoFullPath ) );
        ps.stdout.pipe( service.createStream() ).pipe( ps.stdin );
    }) ).pipe( res );

};
