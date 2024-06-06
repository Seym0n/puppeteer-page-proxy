const got = require("got");
const CookieHandler = require("../lib/cookies");
const { setHeaders, setAgent } = require("../lib/options");
const type = require("../util/types");

// Responsible for applying proxy
const requestHandler = async (request, proxy, overrides = {}) => {
    if (!request.url().startsWith("http") && !request.url().startsWith("https")) {
        request.continue();
        return;
    }
    const cookieHandler = new CookieHandler(request);
    const options = {
        cookieJar: await cookieHandler.getCookies(),
        method: overrides.method || request.method(),
        body: overrides.postData || request.postData(),
        headers: overrides.headers || setHeaders(request),
        agent: setAgent(proxy),
        responseType: "buffer",
        maxRedirects: 15,
        throwHttpErrors: false,
        ignoreInvalidCookies: true,
        followRedirect: false,
    };
    try {
        const response = await got(overrides.url || request.url(), options);
        const setCookieHeader = response.headers["set-cookie"];
        if (setCookieHeader) {
            await cookieHandler.setCookies(setCookieHeader);
            response.headers["set-cookie"] = undefined;
        }
        await request.respond({
            status: response.statusCode,
            headers: response.headers,
            body: response.body,
        });
    } catch (error) {
        await request.abort();
    }
};

// For reassigning proxy of page
const removeRequestListener = (page, listenerName) => {
    page.removeListener("request", page[listenerName]);
};

// Define listeners directly on the page object
const useProxyPer = {
    HTTPRequest: async (request, data) => {
        let proxy, overrides;
        if (type(data) === "object") {
            if (Object.keys(data).length !== 0) {
                proxy = data.proxy;
                delete data.proxy;
                overrides = data;
            }
        } else {
            proxy = data;
        }
        if (proxy) {
            await requestHandler(request, proxy, overrides);
        } else {
            request.continue(overrides);
        }
    },

    CdpPage: async (page, proxy) => {
        await page.setRequestInterception(true);
        const listener = "$ppp_requestListener";
        removeRequestListener(page, listener);
        page[listener] = async request => {
            await requestHandler(request, proxy);
        };
        if (proxy) {
            page.on("request", page[listener]);
        } else {
            await page.setRequestInterception(false);
        }
    },
};

// Main function
const useProxy = async (target, data) => {
    try {
        const targetType = target.constructor.name;
        if (!useProxyPer[targetType]) {
            throw new TypeError(`No proxy handler found for target type: ${targetType}`);
        }
        await useProxyPer[targetType](target, data);
    } catch (error) {
        console.error("Unhandled Rejection at:", error);
    }
};

module.exports = useProxy;
