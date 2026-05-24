export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS cho phép App kết nối
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Admin-Token",
    };
    
    if (method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    const res = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const isAdmin = request.headers.get("Admin-Token") === env.ADMIN_TOKEN;

    try {
      // ================= NHÓM 1: TÀI KHOẢN HỌC SINH =================
      if (path === "/api/users/lookup" && method === "GET") {
        const nameQuery = url.searchParams.get("name") || "";
        let results;
        if (nameQuery.trim() !== "") {
          const { results: filtered } = await env.DB.prepare(`SELECT display_name, username FROM users WHERE display_name LIKE ? ORDER BY display_name`).bind(`%${nameQuery}%`).all();
          results = filtered;
        } else {
          const { results: allUsers } = await env.DB.prepare(`SELECT display_name, username FROM users ORDER BY display_name`).all();
          results = allUsers;
        }
        return res({ success: true, data: results });
      }

      if (path === "/api/register" && method === "POST") {
        const { username, password, display_name } = await request.json();
        if (!username || !password || !display_name) return res({ error: "Vui lòng nhập đầy đủ thông tin!" }, 400);
        
        const cleanUsername = username.trim();
        const existing = await env.DB.prepare(`SELECT 1 FROM users WHERE username=?`).bind(cleanUsername).first();
        if (existing) return res({ error: "Tên đăng nhập đã tồn tại!" }, 400);

        const user_id = crypto.randomUUID();
        await env.DB.prepare(`INSERT INTO users (user_id, username, password, display_name) VALUES (?,?,?,?)`)
          .bind(user_id, cleanUsername, password, display_name.trim()).run();
          
        return res({ success: true, message: "Đăng ký thành công!", user_id, username: cleanUsername });
      }

      if (path === "/api/login" && method === "POST") {
        const { username, password } = await request.json();
        const user = await env.DB.prepare(`SELECT user_id, username, display_name FROM users WHERE username=? AND password=?`)
          .bind(username, password).first();
        if (!user) return res({ error: "Sai tài khoản mật khẩu!" }, 401);
        return res({ success: true, user });
      }

      // ================= NHÓM 2: LƯU BÀI THI (LƯU NGUYÊN CỤC JSON) =================
      if (path === "/api/quiz/submit" && method === "POST") {
        const body = await request.json();
        const { attemptId, userId } = body;

        // Chỉ cần kiểm tra xem có gửi ID lên không
        if (!attemptId || !userId) {
          return res({ error: "Payload thiếu attemptId hoặc userId!" }, 400);
        }

        // Chống nộp đúp
        const checkExist = await env.DB.prepare(`SELECT 1 FROM quiz_history WHERE attempt_id = ?`).bind(attemptId).first();
        if (checkExist) return res({ error: "Lượt làm bài này đã được ghi nhận trước đó!" }, 400);

        // Lưu toàn bộ payload (body) thành chuỗi TEXT vào DB
        await env.DB.prepare(`INSERT INTO quiz_history (attempt_id, user_id, raw_data) VALUES (?, ?, ?)`)
          .bind(attemptId, userId, JSON.stringify(body)).run();

        return res({ success: true, message: "Lưu bài thành công!" });
      }

      // ================= NHÓM 3: ADMIN (Cần Header Admin-Token) =================
      if (path.startsWith("/api/admin/") && !isAdmin) return res({ error: "Lỗi Token Quản trị!" }, 403);

      // Admin tải toàn bộ lịch sử JSON về để tính toán
      if (path === "/api/admin/history" && method === "GET") {
        // Có thể filter theo user_id nếu cần, bằng cách gọi: /api/admin/history?user_id=123
        const targetUserId = url.searchParams.get("user_id");
        let query = `
          SELECT h.attempt_id, h.created_at, h.raw_data, u.display_name, u.username 
          FROM quiz_history h
          JOIN users u ON h.user_id = u.user_id
        `;
        let results;
        
        if (targetUserId) {
          results = (await env.DB.prepare(query + ` WHERE h.user_id = ? ORDER BY h.created_at DESC`).bind(targetUserId).all()).results;
        } else {
          results = (await env.DB.prepare(query + ` ORDER BY h.created_at DESC`).all()).results;
        }

        // Parse lại raw_data từ dạng Chuỗi sang dạng JSON Object trả về cho Admin Web dễ đọc
        const formattedResults = results.map(row => ({
          attempt_id: row.attempt_id,
          created_at: row.created_at,
          display_name: row.display_name,
          username: row.username,
          quiz_data: JSON.parse(row.raw_data) // Tự bung JSON ra
        }));

        return res({ success: true, data: formattedResults });
      }

      // Admin dọn sạch Server
      if (path === "/api/admin/system/reset" && method === "POST") {
        await env.DB.batch([
          env.DB.prepare(`DELETE FROM quiz_history`),
          env.DB.prepare(`DELETE FROM users`)
        ]);
        return res({ success: true, message: "Hệ thống đã được xóa sạch dữ liệu!" });
      }

      // Admin quản lý User
      if (path === "/api/admin/users" && method === "GET") {
        const { results } = await env.DB.prepare(`SELECT user_id, username, display_name, password FROM users ORDER BY username`).all();
        return res({ success: true, data: results });
      }

      if (path === "/api/admin/users/delete" && method === "POST") {
        const { user_id } = await request.json();
        if (!user_id) return res({ error: "Thiếu user_id!" }, 400);
        await env.DB.batch([
          env.DB.prepare(`DELETE FROM quiz_history WHERE user_id = ?`).bind(user_id),
          env.DB.prepare(`DELETE FROM users WHERE user_id = ?`).bind(user_id)
        ]);
        return res({ success: true, message: "Xóa tài khoản thành công!" });
      }

      return res({ error: "Không tìm thấy Route" }, 404);
    } catch (err) {
      return res({ error: "Lỗi hệ thống: " + err.message, stack: err.stack }, 500);
    }
  }
};
