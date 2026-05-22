export default {
  async fetch(request, env) {
    const TARGET_DOMAIN = "https://kai.nl.tab.digital"; 
    
    const USERNAME = env.USERNAME || "";
    const PASSWORD = env.PASSWORD || "";
    const SECURITY_ENABLED = env.SECURITY_ENABLED;
    const allowedOriginsString = env.ALLOWED_ORIGINS || "*";
    const ALLOWED_ORIGINS = allowedOriginsString.split(',').map(url => url.trim());

    const origin = request.headers.get("Origin") || request.headers.get("Referer");

    if (SECURITY_ENABLED === "true") {
      if (!origin) return new Response("Block: Missing Origin", { status: 403 });
      const isAllowed = ALLOWED_ORIGINS.some(url => origin.startsWith(url));
      if (!isAllowed) return new Response(`Block: Origin [${origin}] Not Allowed`, { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": origin || "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK, REPORT",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, OCS-APIRequest, Destination, Overwrite, Depth", 
          "Access-Control-Allow-Credentials": "true",
          "Access-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);
    const targetUrl = TARGET_DOMAIN + url.pathname + url.search;
    
    const proxyHeaders = new Headers(request.headers);
    proxyHeaders.set("Authorization", "Basic " + btoa(`${USERNAME}:${PASSWORD}`));
    proxyHeaders.set("OCS-APIRequest", "true"); 

    const destination = proxyHeaders.get("Destination");
    if (destination) {
      const destUrl = new URL(destination);
      proxyHeaders.set("Destination", TARGET_DOMAIN + destUrl.pathname + destUrl.search);
    }

    proxyHeaders.delete("Host");
    proxyHeaders.delete("Origin");
    proxyHeaders.delete("Referer");

    // 🔥 FIX LỖI 400: Chỉ gửi body nếu phương thức cho phép và body thực sự có dữ liệu
    const permitsBody = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    const requestBody = permitsBody && request.body ? request.body : undefined;

    try {
      const proxyReq = new Request(targetUrl, {
        method: request.method,
        headers: proxyHeaders,
        body: requestBody,
        redirect: "manual"
      });

      const response = await fetch(proxyReq);
      
      const resHeaders = new Headers(response.headers);
      resHeaders.set("Access-Control-Allow-Origin", origin || "*");
      resHeaders.set("Access-Control-Allow-Credentials", "true");
      resHeaders.set("Access-Control-Expose-Headers", "DAV, content-length, Allow");

      return new Response(response.body, {
        status: response.status,
        headers: resHeaders,
      });

    } catch (err) {
      return new Response("Lỗi Server: " + err.message, { status: 500 });
    }
  }
};
    const path = url.searchParams.get("path"); 
    
    if (!path) return new Response("Lỗi: Cần truyền ?path=", { status: 400 });

    const targetUrl = TARGET_DOMAIN + path;
    const nextcloudHeaders = new Headers(request.headers);

    // Gắn Basic Auth
    nextcloudHeaders.set("Authorization", "Basic " + btoa(`${USERNAME}:${PASSWORD}`));
    nextcloudHeaders.set("OCS-APIRequest", "true"); 

    // Xóa header nhạy cảm
    nextcloudHeaders.delete("Host");
    nextcloudHeaders.delete("Origin");
    nextcloudHeaders.delete("Referer");

    try {
      const proxyReq = new Request(targetUrl, {
        method: request.method,
        headers: nextcloudHeaders,
        body: request.body,
        redirect: "follow"
      });

      const response = await fetch(proxyReq);
      
      const resHeaders = new Headers(response.headers);
      resHeaders.set("Access-Control-Allow-Origin", origin || "*");
      resHeaders.set("Access-Control-Allow-Credentials", "true");

      return new Response(response.body, {
        status: response.status,
        headers: resHeaders,
      });

    } catch (err) {
      return new Response("Lỗi Server: " + err.message, { status: 500 });
    }
  }
};
