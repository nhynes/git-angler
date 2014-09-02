module.exports = {
    port: 4242,
    eventPort: 6005,

    pathToRepos: '/home/nhynes/git/igit/src/eventbus/srv/exercises',
    reposMountPoint: '/repos', // trailing slash is optional
    hooksMountPoint: '/hooks',
    eventsMountPoint: '/events',

    handlerTimeout: 5000
};
