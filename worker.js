export default {
  async fetch(request) {
    // ==========================================
    // 1. CẤU HÌNH BIẾN
    // ==========================================
    // KHÓA CHẾT DOMAIN: Tránh bị lợi dụng làm Open Proxy tấn công mạng
    const TARGET_DOMAIN = "https://kai.nl.tab.digital"; 
    
    // TÀI KHOẢN: Khuyên dùng App Password của Nextcloud thay vì mật khẩu gốc
    const USERNAME = "tai_khoan_cua_ban";
    const PASSWORD = "mat_khau_hoac_app_password";
    
    const SECURITY_ENABLED = true; // true = BẬT, false = TẮT
    const ALLOWED_ORIGINS = [
      "http://localhost:5500",
      "http://127.0.0.1:5500",
      "https://ten-cua-ban.github.io"
    ];

    // ==========================================
    // 2. LỌC KẾT NỐI (ANTI-BOT & CORS)
    // ==========================================
    const origin = request.headers.get("Origin") || request.headers.get("Referer");

    if (SECURITY_ENABLED) {
      if (!origin) return new Response("Block: Missing Origin", { status: 403 });
      
      const isAllowed = ALLOWED_ORIGINS.some(url => origin.startsWith(url));
      if (!isAllowed) return new Response("Block: Origin Not Allowed", { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": origin || "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          // Nextcloud cần OCS-APIRequest để vượt qua check CSRF
          "Access-Control-Allow-Headers": "Content-Type, Authorization, OCS-APIRequest", 
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // ==========================================
    // 3. XỬ LÝ ĐƯỜNG DẪN
    // ==========================================
    const url = new URL(request.url);
    const path = url.searchParams.get("path"); 
    
    // Yêu cầu Frontend chỉ gửi PATH (Ví dụ: ?path=/settings/user/security)
    if (!path) return new Response("Lỗi: Cần truyền ?path=", { status: 400 });

    const targetUrl = TARGET_DOMAIN + path;

    // ==========================================
    // 4. XÂY DỰNG REQUEST GỬI NEXTCLOUD
    // ==========================================
    const nextcloudHeaders = new Headers(request.headers);

    // Gắn thông tin đăng nhập (Basic Auth)
    nextcloudHeaders.set("Authorization", "Basic " + btoa(`${USERNAME}:${PASSWORD}`));
    
    // Header bắt buộc của Nextcloud để báo đây là API request, không phải form lừa đảo
    nextcloudHeaders.set("OCS-APIRequest", "true"); 

    // XÓA các header nhạy cảm từ trình duyệt để tránh Nextcloud báo lỗi "Khác Origin"
    nextcloudHeaders.delete("Host");
    nextcloudHeaders.delete("Origin");
    nextcloudHeaders.delete("Referer");

    try {
      const proxyReq = new Request(targetUrl, {
        method: request.method,
        headers: nextcloudHeaders,
        body: request.body,
        redirect: "follow" // Tự động theo dấu nếu Nextcloud trả về mã 301/302
      });

      const response = await fetch(proxyReq);
      
      // Trả về kèm Header cho phép Frontend đọc
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
  },
};
