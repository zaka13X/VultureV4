const hammerhead = require('testcafe-hammerhead');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 1. Initialize Hammerhead Proxy Server
const proxy = hammerhead.createProxyServer(1337, '127.0.0.1');

// 2. Load your Custom HTML Workspace
const workspaceHtmlPath = path.join(__dirname, 'workspace.html');
const workspaceHtml = fs.readFileSync(workspaceHtmlPath, 'utf8');

proxy.server.on('request', (req, res) => {
    // 3. Strip specific forwarding headers
    req.headers['x-forwarded-for'] = '';
    req.headers['cf-connecting-ip'] = '';

    const url = new URL(req.url, `http://${req.headers.host}`);

    // 4. Route requests through /education and decode Base64
    if (url.pathname.startsWith('/education/')) {
        const base64EncodedPart = url.pathname.split('/education/')[1];
        try {
            const decodedUrl = Buffer.from(base64EncodedPart, 'base64').toString('utf8');
            // Re-route Hammerhead proxy session to the decoded destination
            req.url = `/${proxy.getProxyUrl(decodedUrl)}${url.search}`;
        } catch (e) {
            // Fallthrough if base64 decoding fails
        }
    }

    // 5. Serve the provided HTML if the user is requesting the homepage
    if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(workspaceHtml);
    } else {
        // Let Hammerhead process proxied pages and assets natively
        proxy.handleRequest(req, res);
    }
});

console.log('Vulture Workspace proxy is running on http://127.0.0.1:1337');
