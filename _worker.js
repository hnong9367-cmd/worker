export default {
  async fetch(request, env) {
    const TARGET_DOMAIN = "https://kai.nl.tab.digital"; 
    
    // Đọc các biến môi trường từ file wrangler.toml
    const USERNAME = env.USERNAME || "";
    const PASSWORD = env.PASSWORD || "";
    const SECURITY_ENABLED = env.SECURITY_ENABLED;
    
    // Đọc danh sách tên miền cho phép và tách bằng dấu phẩy
    const allowedOriginsString = env.ALLOWED_ORIGINS || "*";
    const ALLOWED_ORIGINS = allowedOriginsString.split(',').map(url => url.trim());

    const origin = request.headers.get("Origin") || request.headers.get("Referer");

    // KIỂM TRA BẢO MẬT (Chỉ chặn khi SECURITY_ENABLED = "true")
    if (SECURITY_ENABLED === "true") {
      if (!origin) return new Response("Block: Missing Origin", { status: 403 });
      
      const isAllowed = ALLOWED_ORIGINS.some(url => origin.startsWith(url));
      if (!isAllowed) return new Response(`Block: Origin [${origin}] Not Allowed`, { status: 403 });
    }

    // XỬ LÝ PREFLIGHT (Trình duyệt gọi OPTIONS trước khi gọi POST/GET)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": origin || "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, OCS-APIRequest", 
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);
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
